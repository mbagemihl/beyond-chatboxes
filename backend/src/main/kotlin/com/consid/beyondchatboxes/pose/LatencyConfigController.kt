package com.consid.beyondchatboxes.pose

import jakarta.validation.Valid
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * Read/update the artificial WAN latency applied to pose-inference responses.
 * Lets the presenter show "same model, add 100 ms of distance" live without a
 * redeploy. An out-of-range value is rejected with 400 (see [LatencyConfig]).
 */
@RestController
@RequestMapping("/api/latency-config")
class LatencyConfigController(private val latency: LatencyConfig) {

    @GetMapping
    fun get(): LatencyConfigResponse =
        LatencyConfigResponse(delayMs = latency.delayMs(), allowedMs = latency.allowedMs)

    @PostMapping
    fun set(@Valid @RequestBody request: LatencyConfigRequest): LatencyConfigResponse {
        // delayMs is @NotNull-validated; membership is enforced here (-> 400).
        latency.setDelayMs(request.delayMs!!)
        return LatencyConfigResponse(delayMs = latency.delayMs(), allowedMs = latency.allowedMs)
    }
}
