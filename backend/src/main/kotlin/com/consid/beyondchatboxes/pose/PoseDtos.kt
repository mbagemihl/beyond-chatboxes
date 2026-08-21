package com.consid.beyondchatboxes.pose

import jakarta.validation.constraints.NotBlank

/**
 * JSON request body for `POST /api/infer/pose` when a client sends the frame as
 * base64 rather than multipart. The value is the base64 of the raw JPEG bytes,
 * with or without a `data:image/jpeg;base64,` prefix (the controller strips it).
 */
data class PoseInferenceRequest(
    @field:NotBlank(message = "imageBase64 must not be blank")
    val imageBase64: String,
)

/** One keypoint in the API response — source-frame normalized coords + score. */
data class KeypointDto(
    val name: String,
    val x: Double,
    val y: Double,
    val score: Double,
)

/**
 * Response for `POST /api/infer/pose`. [inferenceMs] is the SERVER-side model
 * time only (not the round trip) — the frontend derives the "network share" of
 * the cloud bar as (measured round trip − inferenceMs). [backend] names the DJL
 * engine actually running the model, mirroring the browser HUD's backend badge.
 */
data class PoseInferenceResponse(
    val keypoints: List<KeypointDto>,
    val inferenceMs: Double,
    val modelName: String,
    val backend: String,
)
