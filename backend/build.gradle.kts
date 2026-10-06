plugins {
	kotlin("jvm") version "2.2.21"
	kotlin("plugin.spring") version "2.2.21"
	id("org.springframework.boot") version "4.0.7"
	id("io.spring.dependency-management") version "1.1.7"
}

group = "com.consid.beyondchatboxes"
version = "0.0.1-SNAPSHOT"

// Build with whatever JDK 21 or newer runs Gradle, but always emit Java 21
// bytecode, so the jar runs on 21 and every later release. (No toolchain
// block: that would demand exactly a JDK 21 and fail offline without one.)
java {
	sourceCompatibility = JavaVersion.VERSION_21
	targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<JavaCompile> {
	options.release = 21
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
		jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21
		freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
	}
}

// ONNX Runtime loads its native library with System.load, a "restricted
// method" since JDK 22: newer JDKs warn now and will block it later unless
// native access is enabled. Enable it for tests, bootRun and the jar itself.
val nativeAccess = "--enable-native-access=ALL-UNNAMED"

tasks.withType<Test> {
	useJUnitPlatform()
	jvmArgs(nativeAccess)
}

tasks.named<org.springframework.boot.gradle.tasks.run.BootRun>("bootRun") {
	jvmArgs(nativeAccess)
}

// Only produce the runnable Spring Boot fat jar, not the plain library jar,
// and give it a stable name so the stage command never depends on the
// version: `java -jar backend/build/libs/app.jar`.
tasks.named<Jar>("jar") {
	enabled = false
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
	archiveFileName = "app.jar"
	// The same for `java -jar app.jar` (JDK 22+ reads this; 21 ignores it).
	manifest {
		attributes("Enable-Native-Access" to "ALL-UNNAMED")
	}
	// `-Pslim` builds the workshop jar: the API only, without the copied-in
	// frontend (static/ holds ~160 MB of models and wasm the browser serves via
	// `ng serve` anyway). Attendees run it with `lab backend`, no Gradle needed.
	if (project.hasProperty("slim")) {
		exclude("static/**")
	}
}
