package com.consid.beyondchatboxes.pose

import jakarta.validation.constraints.NotNull
import org.springframework.stereotype.Component
import java.util.concurrent.atomic.AtomicInteger

/**
 * Holds the artificial delay (ms) added to pose-inference responses to simulate
 * WAN distance for the on-stage benchmark ("same model, add 100 ms of
 * distance"). Process-wide singleton; the value is read on every request.
 */
@Component
class LatencyConfig {

    /** The delays the demo offers on stage. */
    val allowedMs: List<Int> = listOf(0, 50, 150)

    private val delay = AtomicInteger(0)

    fun delayMs(): Int = delay.get()

    /** @throws IllegalArgumentException if [value] is not one of [allowedMs]. */
    fun setDelayMs(value: Int) {
        require(value in allowedMs) {
            "delayMs must be one of $allowedMs (was $value)"
        }
        delay.set(value)
    }
}

/** Current latency config. */
data class LatencyConfigResponse(val delayMs: Int, val allowedMs: List<Int>)

/** Request body for updating the artificial delay. */
data class LatencyConfigRequest(
    @field:NotNull(message = "delayMs is required")
    val delayMs: Int?,
)
