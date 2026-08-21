package com.consid.beyondchatboxes.pose

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.BDDMockito.given
import org.mockito.Mockito
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.mock.web.MockMultipartFile
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.awt.image.BufferedImage

/**
 * Always-green MockMvc tests for the pose endpoint: they mock the inference
 * service so they exercise request binding, validation, image decoding and
 * error mapping WITHOUT needing the ONNX model on the box. Real end-to-end
 * inference is covered (and gated on the model) by [PoseInferenceIntegrationTest].
 */
@WebMvcTest(PoseController::class)
@Import(ApiExceptionHandler::class)
class PoseControllerValidationTest {

    @Autowired
    lateinit var mockMvc: MockMvc

    @MockitoBean
    lateinit var service: PoseInferenceService

    @MockitoBean
    lateinit var latency: LatencyConfig

    private companion object {
        val PLACEHOLDER_IMAGE: BufferedImage = BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB)
    }

    private val frameBytes: ByteArray =
        javaClass.getResourceAsStream("/sample-frame.jpg")!!.readBytes()

    /**
     * Kotlin-safe `any()` for the non-null [BufferedImage] argument: registers
     * the Mockito matcher (side effect) and returns a non-null placeholder so
     * Kotlin's call-site null check does not fire (Mockito ignores the value).
     */
    private fun anyImage(): BufferedImage {
        Mockito.any(BufferedImage::class.java)
        return PLACEHOLDER_IMAGE
    }

    @BeforeEach
    fun stubs() {
        given(latency.delayMs()).willReturn(0)
        given(service.modelName).willReturn("test-model")
        given(service.backend).willReturn("onnxruntime")
        given(service.infer(anyImage())).willReturn(
            PoseInferenceResult(
                keypoints = listOf(MoveNet.Keypoint("nose", 0.5, 0.4, 0.9)),
                inferenceMs = 12.3,
            ),
        )
    }

    @Test
    fun `multipart frame returns keypoints and server inference ms`() {
        val part = MockMultipartFile("frame", "frame.jpg", "image/jpeg", frameBytes)
        mockMvc.perform(multipart("/api/infer/pose").file(part))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.keypoints[0].name").value("nose"))
            .andExpect(jsonPath("$.keypoints[0].score").value(0.9))
            .andExpect(jsonPath("$.inferenceMs").value(12.3))
            .andExpect(jsonPath("$.backend").value("onnxruntime"))
            .andExpect(jsonPath("$.modelName").value("test-model"))
    }

    @Test
    fun `base64 JSON frame returns keypoints`() {
        val b64 = java.util.Base64.getEncoder().encodeToString(frameBytes)
        mockMvc.perform(
            post("/api/infer/pose")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"imageBase64":"$b64"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.keypoints[0].name").value("nose"))
    }

    @Test
    fun `missing multipart part is a 400`() {
        val wrong = MockMultipartFile("wrongName", "x.jpg", "image/jpeg", frameBytes)
        mockMvc.perform(multipart("/api/infer/pose").file(wrong))
            .andExpect(status().isBadRequest)
    }

    @Test
    fun `empty multipart frame is a 400`() {
        val empty = MockMultipartFile("frame", "frame.jpg", "image/jpeg", ByteArray(0))
        mockMvc.perform(multipart("/api/infer/pose").file(empty))
            .andExpect(status().isBadRequest)
    }

    @Test
    fun `blank imageBase64 is rejected by validation`() {
        mockMvc.perform(
            post("/api/infer/pose")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"imageBase64":""}"""),
        )
            .andExpect(status().isBadRequest)
    }

    @Test
    fun `undecodable base64 payload is a 400`() {
        // Valid base64, but the bytes are not an image.
        val notAnImage = java.util.Base64.getEncoder().encodeToString("hello world".toByteArray())
        mockMvc.perform(
            post("/api/infer/pose")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"imageBase64":"$notAnImage"}"""),
        )
            .andExpect(status().isBadRequest)
    }

    @Test
    fun `model unavailable surfaces as 503`() {
        given(service.infer(anyImage())).willThrow(
            PoseModelUnavailableException("Pose model is not loaded on the server."),
        )
        val part = MockMultipartFile("frame", "frame.jpg", "image/jpeg", frameBytes)
        mockMvc.perform(multipart("/api/infer/pose").file(part))
            .andExpect(status().isServiceUnavailable)
            .andExpect(jsonPath("$.status").value(503))
    }
}
