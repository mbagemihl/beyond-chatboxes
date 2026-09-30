# Beyond the Chatbox — monorepo tasks
#
# Backend targets pin JDK 21 (CLAUDE.md) via SDKMAN, since the machine default
# JDK may differ. Override on the command line if your JDK 21 lives elsewhere:
#   make dev-backend JDK21=/path/to/jdk-21
JDK21 ?= $(HOME)/.sdkman/candidates/java/21.0.2-open
# `java` for the prebuilt workshop jar: the pinned JDK 21 when present, else PATH.
JAVA ?= $(if $(wildcard $(JDK21)/bin/java),$(JDK21)/bin/java,java)
# The backend port. VM/container proxies often squat :8080; move it with
# `make backend BACKEND_PORT=9099` and start the frontend with the same variable.
BACKEND_PORT ?= 8080
BACKEND_JAR  := backend/dist/backend.jar

FRONTEND_DIST := frontend/dist/frontend/browser
STATIC_DIR    := backend/src/main/resources/static

.PHONY: help doctor step-% bonus-% verify-% solve-% backend backend-jar measure-backend dev-frontend dev-backend build build-frontend build-backend test test-frontend test-backend clean

help: ## List available targets
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- Workshop ---

# Spec files that grade each checkpoint (see WORKSHOP.md). `verify-N` runs ONLY
# that checkpoint's tests, so an attendee gets a fast, unambiguous "done yet?"
# instead of a wall of unrelated results. Acts 2a, 2b and 3 are steps 1-3; the
# bonus tracks are `bonus-search` and `bonus-ocr`.
VERIFY_1 := --include=**/litert-setup.spec.ts
VERIFY_2 := --include=**/live-loop.spec.ts
VERIFY_3 := --include=**/race-summary.spec.ts
VERIFY_bonus-search := --include=**/embedding-setup.spec.ts
VERIFY_bonus-ocr := --include=**/ocr-layout.spec.ts --include=**/prompt-api.spec.ts

doctor: ## Check this machine is ready for the workshop (run this first)
	@scripts/doctor.sh

step-%: ## Start an act: make step-1 (still image), -2 (live camera), -3 (race)
	@scripts/workshop-step.sh step $*

bonus-%: ## Start a bonus track: make bonus-search, make bonus-ocr
	@scripts/workshop-step.sh step bonus-$*

verify-%: ## Grade a checkpoint: make verify-1 (-2, -3, -bonus-search, -bonus-ocr)
	cd frontend && npx ng test --no-watch $(VERIFY_$*)

solve-%: ## Reveal a checkpoint's solution: make solve-1 (-2, -3, -bonus-search, ...)
	@scripts/workshop-step.sh solve $*

## --- Act 1: the model on the JVM ---

backend: ## Run the prepared pose backend (prebuilt jar, JDK 21; BACKEND_PORT=8080)
	@if [ -f $(BACKEND_JAR) ]; then \
		$(JAVA) -Dai.djl.offline=true -jar $(BACKEND_JAR) --server.port=$(BACKEND_PORT); \
	else \
		echo "No $(BACKEND_JAR) (copy it from the workshop USB stick, or: make backend-jar)."; \
		echo "Building and running from source with Gradle instead..."; \
		cd backend && JAVA_HOME=$(JDK21) ./gradlew bootRun --args='--server.port=$(BACKEND_PORT)'; \
	fi

backend-jar: ## Build the slim workshop jar (backend/dist/backend.jar) for the USB stick
	cd backend && JAVA_HOME=$(JDK21) ./gradlew bootJar -Pslim
	mkdir -p backend/dist && cp backend/build/libs/app.jar $(BACKEND_JAR)

measure-backend: ## Act 1: time 20 pose requests against the running backend
	@BACKEND_PORT=$(BACKEND_PORT) node scripts/measure-backend.mjs

## --- Development (run in two terminals) ---

dev-backend: ## Run the Spring Boot backend from source (JDK 21; BACKEND_PORT=8080)
	cd backend && JAVA_HOME=$(JDK21) ./gradlew bootRun --args='--server.port=$(BACKEND_PORT)'

dev-frontend: ## Run `ng serve` on :4200 with /api proxied to the backend
	cd frontend && npm install && BACKEND_PORT=$(BACKEND_PORT) npx ng serve

## --- Build (produces one self-contained backend jar) ---

build: build-frontend build-backend ## Build frontend, embed it in the backend, produce a jar

build-frontend: ## Production build of the Angular app into the backend's static resources
	cd frontend && npm install && npx ng build --configuration production
	rm -rf $(STATIC_DIR)
	mkdir -p $(STATIC_DIR)
	cp -R $(FRONTEND_DIST)/. $(STATIC_DIR)/
	@touch $(STATIC_DIR)/.gitkeep # tracked placeholder; keep git status clean after builds

build-backend: ## Package the backend (assumes static assets already copied in)
	cd backend && JAVA_HOME=$(JDK21) ./gradlew bootJar

## --- Test ---

test: test-frontend test-backend ## Run all frontend and backend tests once

test-frontend: ## Run Angular unit tests once (Vitest), no watch
	cd frontend && npm install && npx ng test --no-watch

test-backend: ## Run backend JUnit tests (JDK 21)
	cd backend && JAVA_HOME=$(JDK21) ./gradlew test

clean: ## Remove build outputs and copied static assets
	rm -rf $(FRONTEND_DIST) $(STATIC_DIR)
	cd backend && JAVA_HOME=$(JDK21) ./gradlew clean
