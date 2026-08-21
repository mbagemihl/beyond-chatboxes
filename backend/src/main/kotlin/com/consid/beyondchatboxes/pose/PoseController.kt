package com.consid.beyondchatboxes.pose

import jakarta.validation.Valid
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.io.ByteArrayInputStream
import java.util.Base64
import javax.imageio.ImageIO

/**
 * `POST /api/infer/pose` — the "cloud tier" of the pose benchmark. Accepts a
 * single JPEG frame either as multipart (`frame` part) or base64 JSON, runs it
 * through DJL + ONNX Runtime, and returns keypoints plus the SERVER-side
 * inference time in ms. The configured artificial WAN delay is applied AFTER
 * inference so `inferenceMs` stays a pure model measurement and the frontend
 * can attribute the remainder of the round trip to "network".
 */
@RestController
@RequestMapping("/api/infer/pose")
class PoseController(
    private val service: PoseInferenceService,
    private val latency: LatencyConfig,
) {

    @PostMapping(consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun inferMultipart(@RequestParam("frame") frame: MultipartFile): PoseInferenceResponse {
        if (frame.isEmpty) {
            throw BadImageException("Multipart part 'frame' is empty.")
        }
        return runInference(frame.bytes)
    }

    @PostMapping(consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun inferJson(@Valid @RequestBody request: PoseInferenceRequest): PoseInferenceResponse =
        runInference(decodeBase64(request.imageBase64))

    private fun runInference(bytes: ByteArray): PoseInferenceResponse {
        val image = try {
            ImageIO.read(ByteArrayInputStream(bytes))
        } catch (e: Exception) {
            throw BadImageException("Could not read the frame: ${e.message}")
        } ?: throw BadImageException("Frame is not a decodable image (expected JPEG/PNG).")

        val result = service.infer(image)

        // Simulate WAN distance. Deliberately after inference so inferenceMs is
        // the pure model time; the sleep inflates only the round trip.
        val delay = latency.delayMs()
        if (delay > 0) {
            Thread.sleep(delay.toLong())
        }

        return PoseInferenceResponse(
            keypoints = result.keypoints.map { KeypointDto(it.name, it.x, it.y, it.score) },
            inferenceMs = result.inferenceMs,
            modelName = service.modelName,
            backend = service.backend,
        )
    }

    private fun decodeBase64(value: String): ByteArray {
        // Tolerate a data-URL prefix ("data:image/jpeg;base64,....").
        val comma = value.indexOf(',')
        val payload = if (value.startsWith("data:") && comma >= 0) value.substring(comma + 1) else value
        return try {
            Base64.getDecoder().decode(payload.trim())
        } catch (e: IllegalArgumentException) {
            throw BadImageException("imageBase64 is not valid base64.")
        }
    }
}
