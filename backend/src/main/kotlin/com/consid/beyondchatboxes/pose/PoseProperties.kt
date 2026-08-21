package com.consid.beyondchatboxes.pose

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * Configuration for the pose "cloud tier". [modelPath] is a filesystem path to
 * the MoveNet ONNX model (see scripts/convert-movenet-onnx.sh). Bound from the
 * `app.pose.*` namespace via @ConfigurationPropertiesScan on the application.
 */
@ConfigurationProperties(prefix = "app.pose")
data class PoseProperties(
    val modelPath: String,
)
