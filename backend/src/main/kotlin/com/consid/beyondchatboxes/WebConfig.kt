package com.consid.beyondchatboxes

import org.springframework.context.annotation.Configuration
import org.springframework.core.io.ClassPathResource
import org.springframework.core.io.Resource
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import org.springframework.web.servlet.resource.PathResourceResolver

/**
 * Serves the built Angular app from classpath:/static and falls back to
 * index.html for any path that is not a real file, so client-side (SPA) deep
 * links resolve correctly on a hard refresh.
 *
 * @RestController mappings (e.g. HealthController's /api/health) are matched
 * before this catch-all resource handler, so backend routes are never shadowed.
 * Unknown paths under the /api namespace fall through to index.html rather than
 * a 404; that is acceptable for these demos and can be tightened later.
 */
@Configuration
class WebConfig : WebMvcConfigurer {

    override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
        registry
            .addResourceHandler("/**")
            .addResourceLocations("classpath:/static/")
            .resourceChain(true)
            .addResolver(SpaPathResourceResolver())
    }

    private class SpaPathResourceResolver : PathResourceResolver() {
        private val index = ClassPathResource("/static/index.html")

        override fun getResource(resourcePath: String, location: Resource): Resource? {
            val requested = location.createRelative(resourcePath)
            return if (requested.exists() && requested.isReadable) requested else index
        }
    }
}
