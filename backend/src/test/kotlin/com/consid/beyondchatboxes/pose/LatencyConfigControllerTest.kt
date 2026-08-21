package com.consid.beyondchatboxes.pose

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@WebMvcTest(LatencyConfigController::class)
@Import(LatencyConfig::class, ApiExceptionHandler::class)
class LatencyConfigControllerTest {

    @Autowired
    lateinit var mockMvc: MockMvc

    @Autowired
    lateinit var latency: LatencyConfig

    @BeforeEach
    fun reset() = latency.setDelayMs(0)

    @Test
    fun `GET returns current delay and the allowed set`() {
        mockMvc.perform(get("/api/latency-config"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.delayMs").value(0))
            .andExpect(jsonPath("$.allowedMs").isArray)
            .andExpect(jsonPath("$.allowedMs[0]").value(0))
            .andExpect(jsonPath("$.allowedMs[1]").value(50))
            .andExpect(jsonPath("$.allowedMs[2]").value(150))
    }

    @Test
    fun `POST a valid delay updates it`() {
        mockMvc.perform(
            post("/api/latency-config")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"delayMs":150}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.delayMs").value(150))

        mockMvc.perform(get("/api/latency-config"))
            .andExpect(jsonPath("$.delayMs").value(150))
    }

    @Test
    fun `POST a delay outside the allowed set is rejected`() {
        mockMvc.perform(
            post("/api/latency-config")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"delayMs":999}"""),
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.status").value(400))
    }

    @Test
    fun `POST without delayMs is rejected by validation`() {
        mockMvc.perform(
            post("/api/latency-config")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{}"""),
        )
            .andExpect(status().isBadRequest)
    }
}
