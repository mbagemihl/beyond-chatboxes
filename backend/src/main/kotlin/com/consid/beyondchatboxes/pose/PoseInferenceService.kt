package com.consid.beyondchatboxes.pose

import ai.djl.inference.Predictor
import ai.djl.repository.zoo.Criteria
import ai.djl.repository.zoo.ZooModel
import jakarta.annotation.PostConstruct
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.awt.Color
import java.awt.image.BufferedImage
import java.nio.file.Files
import java.nio.file.Path

/** Result of one server-side inference: keypoints plus the model time in ms. */
data class PoseInferenceResult(
    val keypoints: List<MoveNet.Keypoint>,
    val inferenceMs: Double,
)

/**
 * Server-side ("cloud tier") pose inference via DJL + ONNX Runtime, running the
 * same MoveNet architecture the browser runs.
 *
 * Reliability (CLAUDE.md): the model is loaded and a warmup inference is run at
 * startup, and the [Predictor] is kept warm for the life of the app. If the
 * model file is missing or fails to load, the service stays UNAVAILABLE and
 * logs a clear message rather than crashing the app — the endpoint then returns
 * a clean 503 and the frontend degrades gracefully.
 */
@Service
class PoseInferenceService(private val props: PoseProperties) {

    private val log = LoggerFactory.getLogger(PoseInferenceService::class.java)

    /** DJL predictor is NOT thread-safe; the race issues sequential calls, so a
     *  single warm predictor guarded by this lock is both correct and simplest. */
    private val lock = Any()

    private var model: ZooModel<BufferedImage, FloatArray>? = null
    private var predictor: Predictor<BufferedImage, FloatArray>? = null

    @Volatile
    private var ready = false

    /** DJL engine actually running the model — surfaced to the frontend HUD. */
    val backend: String = "onnxruntime"

    /** Human-readable model name for the response / HUD. */
    val modelName: String = "MoveNet SinglePose Lightning · ONNX (DJL/ONNX Runtime)"

    /** True once the model is loaded and warmed. */
    fun isAvailable(): Boolean = ready

    @PostConstruct
    fun init() {
        // Stage resilience: the configured path is relative to the working
        // directory, which differs between `gradlew bootRun` (backend/) and the
        // single-command `java -jar` from the repo root. Accept either layout
        // rather than fail on a path detail minutes before a talk.
        val candidates = listOf(
            Path.of(props.modelPath),
            Path.of("frontend/public/models/pose/movenet-singlepose-lightning.onnx"),
        )
        val path = candidates.firstOrNull { Files.isReadable(it) }
        if (path == null) {
            log.warn(
                "Pose model not found at {}. The /api/infer/pose endpoint will " +
                    "return 503 until it is present. Convert it with " +
                    "scripts/convert-movenet-onnx.sh (or set APP_POSE_MODEL_PATH).",
                candidates.map { it.toAbsolutePath() },
            )
            return
        }
        try {
            val criteria = Criteria.builder()
                .setTypes(BufferedImage::class.java, FloatArray::class.java)
                .optModelPath(path)
                .optTranslator(MoveNetTranslator())
                .optEngine("OnnxRuntime")
                .build()
            val loaded = criteria.loadModel()
            val warm = loaded.newPredictor()

            // Warmup inference (neutral gray) so the first real request is fast.
            val dummy = BufferedImage(MoveNet.INPUT_SIZE, MoveNet.INPUT_SIZE, BufferedImage.TYPE_INT_RGB)
            val g = dummy.createGraphics()
            g.color = Color(128, 128, 128)
            g.fillRect(0, 0, dummy.width, dummy.height)
            g.dispose()

            val t0 = System.nanoTime()
            warm.predict(dummy)
            val warmupMs = (System.nanoTime() - t0) / 1_000_000.0

            model = loaded
            predictor = warm
            ready = true
            log.info(
                "Pose predictor ready: engine=OnnxRuntime, model='{}', warmup={} ms",
                path.fileName,
                String.format("%.1f", warmupMs),
            )
        } catch (e: Exception) {
            log.error(
                "Failed to load the pose ONNX model at '{}'; /api/infer/pose will return 503.",
                path.toAbsolutePath(),
                e,
            )
        }
    }

    /**
     * Run inference on a decoded frame. Returns keypoints in source-frame
     * normalized coordinates plus the pure model time in ms.
     *
     * @throws PoseModelUnavailableException if the model never loaded.
     */
    fun infer(image: BufferedImage): PoseInferenceResult {
        val p = predictor
            ?: throw PoseModelUnavailableException(
                "Pose model is not loaded on the server (see server logs / convert-movenet-onnx.sh).",
            )
        synchronized(lock) {
            val t0 = System.nanoTime()
            val raw = p.predict(image)
            val inferenceMs = (System.nanoTime() - t0) / 1_000_000.0
            val keypoints = MoveNet.parseOutput(raw, image.width, image.height)
            return PoseInferenceResult(keypoints, inferenceMs)
        }
    }

    @PreDestroy
    fun close() {
        predictor?.close()
        model?.close()
    }
}
