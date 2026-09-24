# Beyond the Chatbox — monorepo tasks
#
# Backend targets pin JDK 21 (CLAUDE.md) via SDKMAN, since the machine default
# JDK may differ. Override on the command line if your JDK 21 lives elsewhere:
#   make dev-backend JDK21=/path/to/jdk-21
JDK21 ?= $(HOME)/.sdkman/candidates/java/21.0.2-open

FRONTEND_DIST := frontend/dist/frontend/browser
STATIC_DIR    := backend/src/main/resources/static

.PHONY: help doctor step-% verify-% solve-% dev-frontend dev-backend build build-frontend build-backend test test-frontend test-backend clean

help: ## List available targets
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- Workshop ---

# Spec files that grade each exercise block (see WORKSHOP.md). `verify-N` runs
# ONLY that block's tests, so an attendee gets a fast, unambiguous "done yet?"
# instead of a wall of unrelated results.
VERIFY_1 := --include=**/pose-math.spec.ts
VERIFY_2 := --include=**/pooling.spec.ts --include=**/similarity.spec.ts
VERIFY_3 := --include=**/ocr-layout.spec.ts --include=**/prompt-api.spec.ts

doctor: ## Check this machine is ready for the workshop (run this first)
	@scripts/doctor.sh

step-%: ## Start an exercise block: make step-1 (or -2, -3)
	@scripts/workshop-step.sh step $*

verify-%: ## Grade one exercise block: make verify-1 (or -2, -3)
	cd frontend && npx ng test --no-watch $(VERIFY_$*)

solve-%: ## Reveal one block's solution: make solve-1 (or -2, -3)
	@scripts/workshop-step.sh solve $*

## --- Development (run in two terminals) ---

dev-backend: ## Run the Spring Boot backend on :8080 (JDK 21)
	cd backend && JAVA_HOME=$(JDK21) ./gradlew bootRun

dev-frontend: ## Run `ng serve` on :4200 with /api proxied to :8080
	cd frontend && npm install && npx ng serve

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
