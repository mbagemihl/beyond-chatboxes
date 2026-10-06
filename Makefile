# Beyond the Chatbox — monorepo tasks
#
# The workshop commands live in the cross-platform `lab` CLI (scripts/lab.mjs:
# Node only, no make or bash, so it also runs on Windows as `.\lab`). The
# workshop targets below are aliases for it; `./lab help` lists them all.
LAB := node scripts/lab.mjs
# The backend port. VM/container proxies often squat :8080; move it with
# `make backend BACKEND_PORT=9099` (or `./lab backend --port 9099`).
BACKEND_PORT ?= 8080
# JAVA_HOME for the Gradle targets: any Java 21 or newer, found the same way
# `lab backend` finds it. Override with JAVA_HOME_FOR_GRADLE=/path/to/jdk.
JAVA_HOME_FOR_GRADLE ?= $(shell $(LAB) java-home)

FRONTEND_DIST := frontend/dist/frontend/browser
STATIC_DIR    := backend/src/main/resources/static

.PHONY: help doctor step-% bonus-% verify-% solve-% jre download backend backend-jar measure-backend dev-frontend dev-backend build build-frontend build-backend test test-frontend test-backend clean

help: ## List available targets
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- Workshop (aliases for ./lab, see `./lab help`) ---

doctor: ## Check this machine is ready for the workshop (run this first)
	@$(LAB) doctor --port $(BACKEND_PORT)

step-%: ## Start an act: make step-1 (still image), -2 (live camera), -3 (race)
	@$(LAB) step $*

bonus-%: ## Start a bonus track: make bonus-search, make bonus-ocr
	@$(LAB) bonus $*

verify-%: ## Grade a checkpoint: make verify-1 (-2, -3, -bonus-search, -bonus-ocr)
	@$(LAB) verify $*

solve-%: ## Reveal a checkpoint's solution: make solve-1 (-2, -3, -bonus-search, ...)
	@$(LAB) solve $*

download: ## Fetch and verify every model artifact (setup time)
	@$(LAB) download

jre: ## Download a portable Java 21 runtime into .tools/jre (only if you have no Java 21+)
	@$(LAB) jre

backend: ## Act 1: run the prepared pose backend (prebuilt jar, Java 21+; BACKEND_PORT=8080)
	@$(LAB) backend --port $(BACKEND_PORT)

backend-jar: ## Build the slim workshop jar (backend/dist/backend.jar)
	@$(LAB) backend-jar

measure-backend: ## Act 1: time 20 pose requests against the running backend
	@$(LAB) measure --port $(BACKEND_PORT)

dev-frontend: ## Run `ng serve` on :4200 with /api proxied to the backend
	@$(LAB) frontend --port $(BACKEND_PORT)

## --- Development ---

dev-backend: ## Run the Spring Boot backend from source (Java 21+; BACKEND_PORT=8080)
	cd backend && JAVA_HOME=$(JAVA_HOME_FOR_GRADLE) ./gradlew bootRun --args='--server.port=$(BACKEND_PORT)'

## --- Build (produces one self-contained backend jar) ---

build: build-frontend build-backend ## Build frontend, embed it in the backend, produce a jar

build-frontend: ## Production build of the Angular app into the backend's static resources
	cd frontend && npm install && npx ng build --configuration production
	rm -rf $(STATIC_DIR)
	mkdir -p $(STATIC_DIR)
	cp -R $(FRONTEND_DIST)/. $(STATIC_DIR)/
	@touch $(STATIC_DIR)/.gitkeep # tracked placeholder; keep git status clean after builds

build-backend: ## Package the backend (assumes static assets already copied in)
	cd backend && JAVA_HOME=$(JAVA_HOME_FOR_GRADLE) ./gradlew bootJar

## --- Test ---

test: test-frontend test-backend ## Run all frontend and backend tests once

test-frontend: ## Run Angular unit tests once (Vitest), no watch
	cd frontend && npm install && npx ng test --no-watch

test-backend: ## Run backend JUnit tests (Java 21+)
	cd backend && JAVA_HOME=$(JAVA_HOME_FOR_GRADLE) ./gradlew test

clean: ## Remove build outputs and copied static assets
	rm -rf $(FRONTEND_DIST) $(STATIC_DIR)
	cd backend && JAVA_HOME=$(JAVA_HOME_FOR_GRADLE) ./gradlew clean
