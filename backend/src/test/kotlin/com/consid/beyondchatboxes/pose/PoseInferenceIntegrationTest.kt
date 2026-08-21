package com.consid.beyondchatboxes.pose

import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.io.ByteArrayInputStream
import javax.imageio.ImageIO
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Real DJL + ONNX Runtime inference on the bundled test frame. GATED on the
 * model being present: it is fetched/converted at build time (not committed),
 * so on a box without it this test is SKIPPED rather than failing the build —
 * `make test-backend` stays green. Locally / on the stage box (after
 * scripts/convert-movenet-onnx.sh) it runs a genuine inference end to end.
 */
@SpringBootTest
class PoseInferenceIntegrationTest {

    @Autowired
    lateinit var service: PoseInferenceService

    @BeforeEach
    fun requireModel() {
        assumeTrue(service.isAvailable(), "Pose ONNX model not present — skipping real inference test.")
    }

    @Test
    fun `runs inference on the bundled frame and returns 17 valid keypoints`() {
        val bytes = javaClass.getResourceAsStream("/sample-frame.jpg")!!.readBytes()
        val image = ImageIO.read(ByteArrayInputStream(bytes))

        val result = service.infer(image)

        assertEquals(MoveNet.NUM_KEYPOINTS, result.keypoints.size)
        assertTrue(result.inferenceMs > 0.0, "inferenceMs should be positive")
        result.keypoints.forEach { kp ->
            assertTrue(kp.score in 0.0..1.0, "score out of range for ${kp.name}: ${kp.score}")
            assertTrue(kp.x.isFinite() && kp.y.isFinite(), "non-finite coord for ${kp.name}")
        }
        // Names must match MoveNet/COCO order, same as the frontend.
        assertEquals("nose", result.keypoints.first().name)
        assertEquals("right_ankle", result.keypoints.last().name)
    }
}
