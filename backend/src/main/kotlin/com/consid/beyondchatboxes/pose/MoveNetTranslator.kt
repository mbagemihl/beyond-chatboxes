package com.consid.beyondchatboxes.pose

import ai.djl.ndarray.NDList
import ai.djl.ndarray.types.DataType
import ai.djl.ndarray.types.Shape
import ai.djl.translate.Batchifier
import ai.djl.translate.Translator
import ai.djl.translate.TranslatorContext
import java.awt.Color
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.nio.ByteBuffer
import kotlin.math.roundToInt

/**
 * DJL translator for MoveNet SinglePose. Takes a decoded [BufferedImage] frame,
 * letterboxes it into the model's square `uint8` `[1, 192, 192, 3]` NHWC input
 * (RGB in [0, 255]) exactly as the browser does, and returns the raw flattened
 * output (`[1, 1, 17, 3]` → 51 floats, [y, x, score] per keypoint). Undoing the
 * letterbox back to source-frame coordinates is done by [PoseInferenceService],
 * which knows the original frame dimensions.
 *
 * Input dtype note: our ONNX export (see scripts/convert-movenet-onnx.sh) takes
 * `uint8` pixels, verified against the model's own signature — feeding int32
 * makes ONNX Runtime reject the call.
 *
 * Stateless, so a single instance is safe to share across the warm predictor.
 */
class MoveNetTranslator : Translator<BufferedImage, FloatArray> {

    // We build the batch dimension ourselves ([1, H, W, 3]); disable DJL's
    // automatic stacking so the input shape is not batched twice.
    override fun getBatchifier(): Batchifier? = null

    override fun processInput(ctx: TranslatorContext, input: BufferedImage): NDList {
        val size = MoveNet.INPUT_SIZE
        val lb = MoveNet.letterbox(input.width, input.height, size)

        val square = BufferedImage(size, size, BufferedImage.TYPE_INT_RGB)
        val g = square.createGraphics()
        try {
            g.color = Color.BLACK
            g.fillRect(0, 0, size, size)
            g.setRenderingHint(
                RenderingHints.KEY_INTERPOLATION,
                RenderingHints.VALUE_INTERPOLATION_BILINEAR,
            )
            g.drawImage(
                input,
                lb.padX.roundToInt(),
                lb.padY.roundToInt(),
                lb.scaledW.roundToInt(),
                lb.scaledH.roundToInt(),
                null,
            )
        } finally {
            g.dispose()
        }

        // Pack RGB into a flat uint8 buffer in [0, 255], row-major, matching the
        // model's NHWC input. Bytes carry 0..255 unsigned (0x80.toByte() == -128).
        val buffer = ByteBuffer.allocate(size * size * 3)
        for (y in 0 until size) {
            for (x in 0 until size) {
                val rgb = square.getRGB(x, y)
                buffer.put(((rgb shr 16) and 0xFF).toByte())
                buffer.put(((rgb shr 8) and 0xFF).toByte())
                buffer.put((rgb and 0xFF).toByte())
            }
        }
        buffer.rewind()

        val arr = ctx.ndManager.create(buffer, Shape(1, size.toLong(), size.toLong(), 3), DataType.UINT8)
        return NDList(arr)
    }

    override fun processOutput(ctx: TranslatorContext, list: NDList): FloatArray {
        // Model may emit float16/float32; normalize to float32 before reading.
        return list[0].toType(DataType.FLOAT32, false).toFloatArray()
    }
}
