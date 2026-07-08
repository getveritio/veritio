package main

import (
	"fmt"
	"net/http"
	"sync"

	veritio "github.com/getveritio/veritio/sdks/go"
	"github.com/gin-gonic/gin"
)

const (
	demoTenantID = "tenant_demo"
	demoUserID   = "user_demo"
)

type demoState struct {
	mutex         sync.Mutex
	projects      map[string]project
	nextProjectID int
	auditRecords  []veritio.AuditRecord
	edgeRecords   []veritio.EvidenceEdgeRecord
	commitRecords []veritio.EvidenceCommit
}

type project struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	Deleted bool   `json:"deleted,omitempty"`
}

type createProjectRequest struct {
	Name string `json:"name" binding:"required"`
}

type updateProjectRequest struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

type verificationResult struct {
	OK     bool     `json:"ok"`
	Errors []string `json:"errors,omitempty"`
}

// main starts the standalone demo server while keeping tenant and actor scope
// fixed at the host boundary instead of accepting those values from clients.
func main() {
	if err := setupRouter(newDemoState()).Run(":8080"); err != nil {
		panic(err)
	}
}

// newDemoState creates the in-memory store used by the example and tests; it is
// deliberately self-contained so the OSS example needs no hosted account or
// proprietary storage service.
func newDemoState() *demoState {
	return &demoState{
		projects:      map[string]project{},
		nextProjectID: 1,
	}
}

// setupRouter wires explicit CRUD mutation handlers to Veritio recording so
// the framework stays a thin transport layer over the public Go SDK.
func setupRouter(state *demoState) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	router.POST("/projects", state.createProject)
	router.PUT("/projects/:id", state.updateProject)
	router.DELETE("/projects/:id", state.deleteProject)
	router.GET("/evidence", state.readEvidence)
	router.POST("/scenarios/governed-lifecycle", state.runGovernedLifecycleScenario)
	return router
}

// createProject persists a demo project and appends both an audit record and a
// graph edge using server-owned tenant and actor identifiers.
func (state *demoState) createProject(context *gin.Context) {
	var request createProjectRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		context.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	state.mutex.Lock()
	defer state.mutex.Unlock()

	projectID := fmt.Sprintf("project_%d", state.nextProjectID)
	state.nextProjectID++
	created := project{ID: projectID, Name: request.Name, Status: "active"}
	state.projects[projectID] = created

	if err := state.recordProjectMutation(nil, created, "project.created"); err != nil {
		context.JSON(http.StatusInternalServerError, gin.H{"error": "could not record evidence"})
		return
	}

	context.JSON(http.StatusCreated, created)
}

// updateProject changes mutable demo project fields and records the modified
// relation without trusting tenant, actor, or scope data from the request body.
func (state *demoState) updateProject(context *gin.Context) {
	projectID := context.Param("id")
	var request updateProjectRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		context.JSON(http.StatusBadRequest, gin.H{"error": "invalid project update"})
		return
	}

	state.mutex.Lock()
	defer state.mutex.Unlock()

	existing, ok := state.projects[projectID]
	if !ok || existing.Deleted {
		context.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}
	before := existing
	if request.Name != "" {
		existing.Name = request.Name
	}
	if request.Status != "" {
		existing.Status = request.Status
	}
	state.projects[projectID] = existing

	if err := state.recordProjectMutation(&before, existing, "project.updated"); err != nil {
		context.JSON(http.StatusInternalServerError, gin.H{"error": "could not record evidence"})
		return
	}

	context.JSON(http.StatusOK, existing)
}

// deleteProject marks the project deleted and records deletion evidence instead
// of physically removing the row before the audit chain can reference it.
func (state *demoState) deleteProject(context *gin.Context) {
	projectID := context.Param("id")

	state.mutex.Lock()
	defer state.mutex.Unlock()

	existing, ok := state.projects[projectID]
	if !ok || existing.Deleted {
		context.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}
	before := existing
	existing.Deleted = true
	existing.Status = "deleted"
	state.projects[projectID] = existing

	if err := state.recordProjectMutation(&before, existing, "project.deleted"); err != nil {
		context.JSON(http.StatusInternalServerError, gin.H{"error": "could not record evidence"})
		return
	}

	context.JSON(http.StatusOK, gin.H{"id": projectID, "deleted": true})
}

// readEvidence exposes the current in-memory evidence chains plus verification
// status so tests and readers can see the SDK hashes remain internally valid.
func (state *demoState) readEvidence(context *gin.Context) {
	state.mutex.Lock()
	defer state.mutex.Unlock()

	context.JSON(http.StatusOK, gin.H{
		"auditRecords":       state.auditRecords,
		"edgeRecords":        state.edgeRecords,
		"commitRecords":      state.commitRecords,
		"auditVerification":  verifyAuditRecords(state.auditRecords),
		"edgeVerification":   verifyEdgeRecords(state.edgeRecords),
		"commitVerification": veritio.VerifyEvidenceCommits(state.commitRecords),
	})
}

// runGovernedLifecycleScenario records a larger helper-driven workflow with
// auth, organization, consent, data-subject, export, retention, and graph edges.
func (state *demoState) runGovernedLifecycleScenario(context *gin.Context) {
	state.mutex.Lock()
	defer state.mutex.Unlock()

	result, err := state.recordGovernedLifecycleScenario()
	if err != nil {
		context.JSON(http.StatusInternalServerError, gin.H{"error": "could not record scenario"})
		return
	}
	context.JSON(http.StatusOK, result)
}
