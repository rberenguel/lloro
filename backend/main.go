package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

const (
	DefaultPort  = 6363
	DefaultModel = "gemini-3-flash-preview"
)

// AgentWrapper manages the gemini-cli subprocess in ACP mode
type AgentWrapper struct {
	mu        sync.Mutex
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    io.ReadCloser
	reader    *bufio.Reader
	model     string
	reqID     int
	sessionID string
	useACP    bool
}

func NewAgentWrapper() *AgentWrapper {
	return &AgentWrapper{
		useACP: true, // Try ACP mode first
	}
}

func (a *AgentWrapper) Start(model string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Kill existing process if running
	if a.cmd != nil && a.cmd.Process != nil {
		a.cmd.Process.Kill()
		a.cmd.Wait()
	}

	a.model = model
	a.reqID = 0
	a.sessionID = "" // Will be set by session/create

	if a.useACP {
		return a.startACP(model)
	}
	return nil // Non-ACP mode doesn't need persistent process
}

func (a *AgentWrapper) startACP(model string) error {
	// Spawn gemini-cli in ACP mode
	a.cmd = exec.Command("gemini", "--experimental-acp", "--model", model)
	a.cmd.Stderr = os.Stderr

	var err error
	a.stdin, err = a.cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	a.stdout, err = a.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	a.reader = bufio.NewReader(a.stdout)

	if err := a.cmd.Start(); err != nil {
		a.useACP = false
		log.Printf("ACP mode failed, will use non-interactive mode: %v", err)
		return nil
	}

	log.Printf("Started gemini-cli in ACP mode with model: %s (PID: %d)", model, a.cmd.Process.Pid)

	// Send initialize request
	if err := a.initialize(); err != nil {
		log.Printf("ACP initialize failed, falling back to non-interactive mode: %v", err)
		a.cmd.Process.Kill()
		a.cmd.Wait()
		a.cmd = nil
		a.useACP = false
		return nil
	}

	return nil
}

func (a *AgentWrapper) initialize() error {
	// Step 1: Initialize protocol
	a.reqID++
	initReq := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      a.reqID,
		"method":  "initialize",
		"params": map[string]interface{}{
			"protocolVersion": 1,
			"clientInfo": map[string]interface{}{
				"name":    "lloro",
				"version": "1.0.0",
			},
			"clientCapabilities": map[string]interface{}{},
		},
	}

	if err := a.sendJSON(initReq); err != nil {
		return err
	}

	resp, err := a.readJSON()
	if err != nil {
		return err
	}
	log.Printf("[ACP] Initialize response: %v", resp)

	// Check for error in response
	if errObj, hasError := resp["error"]; hasError {
		return fmt.Errorf("initialize error: %v", errObj)
	}

	// Step 2: Send initialized notification
	initializedNotif := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "initialized",
	}
	if err := a.sendJSON(initializedNotif); err != nil {
		return err
	}

	// Step 3: Create new session
	cwd, _ := os.Getwd()
	a.reqID++
	newSessionReq := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      a.reqID,
		"method":  "session/new",
		"params": map[string]interface{}{
			"cwd":        cwd,
			"mcpServers": []interface{}{},
		},
	}

	if err := a.sendJSON(newSessionReq); err != nil {
		return err
	}

	resp, err = a.readJSON()
	if err != nil {
		return err
	}
	log.Printf("[ACP] Session new response: %v", resp)

	// Check for error
	if errObj, hasError := resp["error"]; hasError {
		return fmt.Errorf("session/new error: %v", errObj)
	}

	// Extract session ID from response
	if result, ok := resp["result"].(map[string]interface{}); ok {
		if sid, ok := result["sessionId"].(string); ok {
			a.sessionID = sid
			log.Printf("[ACP] Session ID: %s", a.sessionID)
		}
	}

	if a.sessionID == "" {
		return fmt.Errorf("failed to get session ID from response")
	}

	return nil
}

func (a *AgentWrapper) sendJSON(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	log.Printf("[ACP] Sending: %s", string(data))
	_, err = fmt.Fprintf(a.stdin, "%s\n", data)
	return err
}

func (a *AgentWrapper) readJSON() (map[string]interface{}, error) {
	line, err := a.reader.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	log.Printf("[ACP] Received: %s", string(line))

	var result map[string]interface{}
	if err := json.Unmarshal(line, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *AgentWrapper) ChatACP(prompt string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.reqID++

	// Send session/prompt request
	promptReq := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      a.reqID,
		"method":  "session/prompt",
		"params": map[string]interface{}{
			"sessionId": a.sessionID,
			"prompt": []map[string]interface{}{
				{
					"type": "text",
					"text": prompt,
				},
			},
		},
	}

	if err := a.sendJSON(promptReq); err != nil {
		return "", fmt.Errorf("failed to send prompt: %w", err)
	}

	// Read responses until we get the final result
	var responseText strings.Builder
	for {
		resp, err := a.readJSON()
		if err != nil {
			if err == io.EOF {
				break
			}
			return "", fmt.Errorf("failed to read response: %w", err)
		}

		// Check if it's a notification (session/update)
		if method, ok := resp["method"].(string); ok && method == "session/update" {
			if params, ok := resp["params"].(map[string]interface{}); ok {
				if update, ok := params["update"].(map[string]interface{}); ok {
					// Handle agent_message_chunk updates
					if sessionUpdate, ok := update["sessionUpdate"].(string); ok && sessionUpdate == "agent_message_chunk" {
						if content, ok := update["content"].(map[string]interface{}); ok {
							if text, ok := content["text"].(string); ok {
								responseText.WriteString(text)
							}
						}
					}
				}
			}
			continue
		}

		// Check if it's the final response (has result or error)
		if _, hasResult := resp["result"]; hasResult {
			// Final response received
			if result, ok := resp["result"].(map[string]interface{}); ok {
				if stopReason, ok := result["stopReason"].(string); ok {
					log.Printf("[ACP] Stop reason: %s", stopReason)
				}
			}
			break
		}

		if errObj, hasError := resp["error"]; hasError {
			return "", fmt.Errorf("agent error: %v", errObj)
		}
	}

	return responseText.String(), nil
}

// ChatSimple uses non-interactive mode (fallback)
func (a *AgentWrapper) ChatSimple(prompt string) (string, error) {
	log.Printf("[Simple] Running gemini with prompt length: %d", len(prompt))

	cmd := exec.Command("gemini", "-p", prompt, "--output-format", "json", "--model", a.model)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		log.Printf("[Simple] Error: %v, stderr: %s", err, stderr.String())
		return "", fmt.Errorf("gemini failed: %w - %s", err, stderr.String())
	}

	output := stdout.String()
	log.Printf("[Simple] Raw output length: %d", len(output))

	// Try to parse JSON output
	var result struct {
		Response string `json:"response"`
		Text     string `json:"text"`
		Content  string `json:"content"`
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	if err := json.Unmarshal([]byte(output), &result); err != nil {
		// If JSON parsing fails, return raw output
		log.Printf("[Simple] JSON parse failed, returning raw output")
		return strings.TrimSpace(output), nil
	}

	// Try different fields
	if result.Response != "" {
		return result.Response, nil
	}
	if result.Text != "" {
		return result.Text, nil
	}
	if result.Content != "" {
		return result.Content, nil
	}
	if len(result.Candidates) > 0 && len(result.Candidates[0].Content.Parts) > 0 {
		return result.Candidates[0].Content.Parts[0].Text, nil
	}

	return strings.TrimSpace(output), nil
}

func (a *AgentWrapper) Chat(prompt string) (string, error) {
	if a.useACP && a.cmd != nil && a.cmd.Process != nil {
		return a.ChatACP(prompt)
	}
	return a.ChatSimple(prompt)
}

func (a *AgentWrapper) Stop() {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.cmd != nil && a.cmd.Process != nil {
		a.cmd.Process.Kill()
		a.cmd.Wait()
		log.Printf("Stopped gemini-cli agent")
	}
	a.cmd = nil
}

func (a *AgentWrapper) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.useACP && a.cmd != nil && a.cmd.Process != nil
}

func (a *AgentWrapper) GetModel() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.model
}

func (a *AgentWrapper) GetMode() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.useACP && a.cmd != nil {
		return "acp"
	}
	return "simple"
}

// JSON-RPC Server types
type RPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type RPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Server handles JSON-RPC requests
type Server struct {
	agent *AgentWrapper
}

func NewServer() *Server {
	return &Server{
		agent: NewAgentWrapper(),
	}
}

type InitSessionParams struct {
	Model string `json:"model"`
}

type InitSessionResult struct {
	Success bool   `json:"success"`
	Model   string `json:"model"`
	Mode    string `json:"mode"`
}

func (s *Server) InitSession(params InitSessionParams) (*InitSessionResult, error) {
	model := params.Model
	if model == "" {
		model = DefaultModel
	}

	if err := s.agent.Start(model); err != nil {
		return nil, err
	}

	return &InitSessionResult{
		Success: true,
		Model:   model,
		Mode:    s.agent.GetMode(),
	}, nil
}

type ChatParams struct {
	Message string `json:"message"`
	Context string `json:"context"`
}

type ChatResult struct {
	Response string `json:"response"`
}

func (s *Server) Chat(params ChatParams) (*ChatResult, error) {
	log.Printf("[Chat] Message: %s, Context length: %d", params.Message, len(params.Context))

	// Ensure agent is initialized
	if s.agent.GetModel() == "" {
		log.Printf("[Chat] Agent not initialized, starting with default model")
		if err := s.agent.Start(DefaultModel); err != nil {
			return nil, fmt.Errorf("failed to start agent: %w", err)
		}
	}

	// Build the prompt with context
	var prompt string
	if params.Context != "" {
		prompt = fmt.Sprintf("Page content:\n\n%s\n\n---\n\nUser question: %s", params.Context, params.Message)
	} else {
		prompt = params.Message
	}

	log.Printf("[Chat] Prompt length: %d, Mode: %s", len(prompt), s.agent.GetMode())

	response, err := s.agent.Chat(prompt)
	if err != nil {
		log.Printf("[Chat] Error: %v", err)
		return nil, err
	}

	log.Printf("[Chat] Response length: %d", len(response))
	return &ChatResult{Response: response}, nil
}

// CORS middleware
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Allow chrome-extension:// origins and localhost for development
		if strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "http://localhost") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}

		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RPCRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeRPCError(w, nil, -32700, "Parse error")
		return
	}

	log.Printf("[RPC] Method: %s", req.Method)

	var result interface{}
	var rpcErr *RPCError

	switch req.Method {
	case "InitSession":
		var params InitSessionParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			rpcErr = &RPCError{Code: -32602, Message: "Invalid params"}
		} else {
			res, err := s.InitSession(params)
			if err != nil {
				rpcErr = &RPCError{Code: -32000, Message: err.Error()}
			} else {
				result = res
			}
		}

	case "Chat":
		var params ChatParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			rpcErr = &RPCError{Code: -32602, Message: "Invalid params"}
		} else {
			res, err := s.Chat(params)
			if err != nil {
				rpcErr = &RPCError{Code: -32000, Message: err.Error()}
			} else {
				result = res
			}
		}

	default:
		rpcErr = &RPCError{Code: -32601, Message: "Method not found"}
	}

	resp := RPCResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
	}

	if rpcErr != nil {
		resp.Error = rpcErr
	} else {
		resp.Result = result
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func writeRPCError(w http.ResponseWriter, id interface{}, code int, message string) {
	resp := RPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &RPCError{Code: code, Message: message},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func main() {
	port := DefaultPort
	if p := os.Getenv("PORT"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil {
			port = parsed
		}
	}

	server := NewServer()

	mux := http.NewServeMux()
	mux.HandleFunc("/rpc", server.handleRPC)

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"model":  server.agent.GetModel(),
			"mode":   server.agent.GetMode(),
		})
	})

	handler := corsMiddleware(mux)

	addr := fmt.Sprintf(":%d", port)
	log.Printf("Starting Gemini CLI wrapper server on http://localhost%s", addr)
	log.Printf("RPC endpoint: http://localhost%s/rpc", addr)

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}
