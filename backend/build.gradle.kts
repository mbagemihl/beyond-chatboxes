plugins {
	kotlin("jvm") version "2.2.21"
	kotlin("plugin.spring") version "2.2.21"
	id("org.springframework.boot") version "4.0.7"
	id("io.spring.dependency-management") version "1.1.7"
}

group = "com.consid.beyondchatboxes"
version = "0.0.1-SNAPSHOT"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

repositories {
	mavenCentral()
}

dependencies {
	implementation("org.springframework.boot:spring-boot-starter-webmvc")
	implementation("org.springframework.boot:spring-boot-starter-validation")
	implementation("org.jetbrains.kotlin:kotlin-reflect")
	implementation("tools.jackson.module:jackson-module-kotlin")

	// DJL with the ONNX Runtime engine — server-side ("cloud tier") inference on
	// the SAME MoveNet architecture the browser runs (an ONNX export of our
	// tflite model). The onnxruntime-engine is a runtime dep: the app codes
	// against the ai.djl:api abstractions, the engine is discovered on the
	// classpath. See PoseInferenceService and scripts/convert-movenet-onnx.sh.
	implementation(platform("ai.djl:bom:0.36.0"))
	implementation("ai.djl:api")
	runtimeOnly("ai.djl.onnxruntime:onnxruntime-engine")

	testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
	testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
	compilerOptions {
		freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
	}
}

tasks.withType<Test> {
	useJUnitPlatform()
}

// Only produce the runnable Spring Boot fat jar, not the plain library jar,
// and give it a stable name so the stage command never depends on the
// version: `java -jar backend/build/libs/app.jar`.
tasks.named<Jar>("jar") {
	enabled = false
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
	archiveFileName = "app.jar"
}
