# Example VS Code MCP Configuration

## Workspace-specific Configuration
Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "ai-collaboration": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/ai-collaboration-mcp-server/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your_claude_key_here",
        "OPENAI_API_KEY": "your_openai_key_here",
        "GEMINI_API_KEY": "your_gemini_key_here",
        "OLLAMA_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

## Global Configuration  
Create `~/.vscode/mcp.json`:

```json
{
  "servers": {
    "ai-collaboration": {
      "type": "stdio",
      "command": "node", 
      "args": ["/absolute/path/to/ai-collaboration-mcp-server/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your_claude_key_here",
        "OPENAI_API_KEY": "your_openai_key_here",
        "GEMINI_API_KEY": "your_gemini_key_here",
        "OLLAMA_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

## VS Code Settings (Optional)
Add to `settings.json` for auto-start:

```json
{
  "chat.mcp.autostart": "newAndOutdated"
}
```

## Important Notes

1. **Use absolute paths** for the server location
2. **Replace placeholder API keys** with your actual keys
3. **Restart VS Code** after configuration changes
4. **Test with** `@workspace use consult_ai` in VS Code chat
