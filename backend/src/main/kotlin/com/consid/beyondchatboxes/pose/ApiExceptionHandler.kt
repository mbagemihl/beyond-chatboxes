package com.consid.beyondchatboxes.pose

import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.multipart.MaxUploadSizeExceededException
import org.springframework.web.multipart.support.MissingServletRequestPartException

/** A decodable image could not be produced from the request. */
class BadImageException(message: String) : RuntimeException(message)

/** The pose model is not loaded (missing/failed at startup) — request cannot be served. */
class PoseModelUnavailableException(message: String) : RuntimeException(message)

/** Consistent error envelope for the /api surface. */
data class ApiError(val status: Int, val message: String)

/**
 * Maps the pose API's failure modes to clean HTTP responses so the frontend
 * (and the stage demo) never sees a stack trace or a blank body:
 *  - bad/undecodable frame, malformed JSON, missing part, bad latency value -> 400
 *  - upload too large -> 413
 *  - model not loaded on the server -> 503
 */
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(BadImageException::class)
    fun badImage(e: BadImageException) = error(HttpStatus.BAD_REQUEST, e.message)

    @ExceptionHandler(IllegalArgumentException::class)
    fun illegalArgument(e: IllegalArgumentException) = error(HttpStatus.BAD_REQUEST, e.message)

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun invalidBody(e: MethodArgumentNotValidException): ResponseEntity<ApiError> {
        val detail = e.bindingResult.fieldErrors.firstOrNull()?.let { "${it.field}: ${it.defaultMessage}" }
            ?: "Request body failed validation."
        return error(HttpStatus.BAD_REQUEST, detail)
    }

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun unreadable(e: HttpMessageNotReadableException) =
        error(HttpStatus.BAD_REQUEST, "Malformed request body.")

    @ExceptionHandler(MissingServletRequestPartException::class)
    fun missingPart(e: MissingServletRequestPartException) =
        error(HttpStatus.BAD_REQUEST, "Missing multipart part: ${e.requestPartName}.")

    @ExceptionHandler(MissingServletRequestParameterException::class)
    fun missingParam(e: MissingServletRequestParameterException) =
        error(HttpStatus.BAD_REQUEST, "Missing request parameter: ${e.parameterName}.")

    @ExceptionHandler(MaxUploadSizeExceededException::class)
    fun tooLarge(e: MaxUploadSizeExceededException) =
        error(HttpStatus.PAYLOAD_TOO_LARGE, "Uploaded frame is too large.")

    @ExceptionHandler(PoseModelUnavailableException::class)
    fun unavailable(e: PoseModelUnavailableException) =
        error(HttpStatus.SERVICE_UNAVAILABLE, e.message)

    private fun error(status: HttpStatus, message: String?): ResponseEntity<ApiError> =
        ResponseEntity.status(status).body(ApiError(status.value(), message ?: status.reasonPhrase))
}
