package com.consid.beyondchatboxes

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/** Payload for the health probe. Immutable, serialized by the Kotlin Jackson module. */
data class HealthStatus(val status: String)

/**
 * Liveness probe under the /api namespace. The /api prefix keeps backend routes
 * disjoint from the SPA routes served by [WebConfig], and is the same prefix the
 * dev proxy (frontend/proxy.conf.json) forwards to :8080.
 */
@RestController
class HealthController {

    @GetMapping("/api/health")
    fun health(): HealthStatus = HealthStatus(status = "UP")
}
