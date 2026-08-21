package com.consid.beyondchatboxes.pose

/**
 * Pure, framework-free MoveNet geometry — the Kotlin twin of the frontend's
 * `pose-math.ts`. Kept dependency-free (no DJL / Spring) so it is trivially
 * unit-testable and so the server produces keypoints in the EXACT same
 * coordinate convention the browser does: normalized to [0, 1] over the
 * ORIGINAL source frame, after the letterbox padding used for inference is
 * undone. Output triples are ordered [y, x, score], matching MoveNet.
 */
object MoveNet {

    /** MoveNet SinglePose Lightning native square input side. */
    const val INPUT_SIZE = 192

    /** Number of keypoints (COCO topology). */
    const val NUM_KEYPOINTS = 17

    /** COCO keypoint names in the exact order MoveNet emits them. */
    val KEYPOINT_NAMES: List<String> = listOf(
        "nose",
        "left_eye",
        "right_eye",
        "left_ear",
        "right_ear",
        "left_shoulder",
        "right_shoulder",
        "left_elbow",
        "right_elbow",
        "left_wrist",
        "right_wrist",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
    )

    /**
     * Geometry for fitting a `srcW x srcH` frame into a centered `square`
     * (aspect-ratio preserving, equal padding on the short axis) — matches TF's
     * `resize_with_pad` and the frontend's `computeLetterbox`.
     */
    data class Letterbox(
        val scale: Double,
        val scaledW: Double,
        val scaledH: Double,
        val padX: Double,
        val padY: Double,
    )

    fun letterbox(srcW: Int, srcH: Int, square: Int = INPUT_SIZE): Letterbox {
        val scale = square.toDouble() / maxOf(srcW, srcH)
        val scaledW = srcW * scale
        val scaledH = srcH * scale
        return Letterbox(
            scale = scale,
            scaledW = scaledW,
            scaledH = scaledH,
            padX = (square - scaledW) / 2.0,
            padY = (square - scaledH) / 2.0,
        )
    }

    /**
     * Convert a coordinate normalized over the padded square input back into one
     * normalized over the original source frame. Inverts [letterbox]. Returns
     * (x, y).
     */
    fun squareToSource(
        nx: Double,
        ny: Double,
        srcW: Int,
        srcH: Int,
        square: Int = INPUT_SIZE,
    ): Pair<Double, Double> {
        val lb = letterbox(srcW, srcH, square)
        val x = (nx * square - lb.padX) / lb.scaledW
        val y = (ny * square - lb.padY) / lb.scaledH
        return x to y
    }

    /**
     * Parse a raw MoveNet output tensor (flattened `[1, 1, 17, 3]` = 51 numbers,
     * three per keypoint in [y, x, score] order, y/x normalized over the padded
     * square) into keypoints in source-frame normalized coordinates.
     */
    fun parseOutput(raw: FloatArray, srcW: Int, srcH: Int, square: Int = INPUT_SIZE): List<Keypoint> {
        require(raw.size >= NUM_KEYPOINTS * 3) {
            "MoveNet output too short: expected ${NUM_KEYPOINTS * 3}, got ${raw.size}"
        }
        return (0 until NUM_KEYPOINTS).map { i ->
            val ny = raw[i * 3].toDouble()
            val nx = raw[i * 3 + 1].toDouble()
            val score = raw[i * 3 + 2].toDouble()
            val (x, y) = squareToSource(nx, ny, srcW, srcH, square)
            Keypoint(name = KEYPOINT_NAMES[i], x = x, y = y, score = score)
        }
    }

    /** A single detected keypoint in source-frame normalized coordinates. */
    data class Keypoint(
        val name: String,
        val x: Double,
        val y: Double,
        val score: Double,
    )
}
