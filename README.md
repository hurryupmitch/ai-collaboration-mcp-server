# AI Collaboration MCP Server

A streamlined Model Context Protocol (MCP) server that provides enhanced AI collaboration tools for VS Code with automatic project context injection and conversation history.

## 🚀 Features

- **Multi-Provider Support**: Claude, GPT-4, Gemini, and Ollama
- **Automatic Context Injection**: Project files, structure, and README automatically included
- **Conversation History**: Persistent conversation memory across sessions
- **API Call Management**: Rate limiting (3 calls per provider per hour)
- **Streamlined Tools**: Just 3 essential tools instead of complex tool proliferation

## 🛠️ Tools Available

### 1. `consult_ai`
Get expert advice from a specific AI provider with full project context.

**Usage in VS Code:**
```
@workspace use consult_ai with claude about error handling best practices
```

### 2. `multi_ai_research` 
Get perspectives from multiple AI providers on complex questions.

**Usage in VS Code:**
```
@workspace use multi_ai_research to analyze authentication approaches
```

### 3. `mandatory_execute`
Force tool execution with explicit commands.

**Usage in VS Code:**
```
@workspace !consult_ai
@workspace use multi_ai_research
```

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- VS Code with MCP support
- API keys for desired AI providers

### 1. Clone and Setup
```bash
git clone https://github.com/yourusername/ai-collaboration-mcp-server.git
cd ai-collaboration-mcp-server
npm install
```

### 2. Configure Environment Variables
Create a `.env` file:
```env
# AI Provider API Keys (add the ones you want to use)
ANTHROPIC_API_KEY=your_claude_key_here
OPENAI_API_KEY=your_openai_key_here  
GEMINI_API_KEY=your_gemini_key_here

# Ollama Configuration (for local AI)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:latest
```

### 3. Build the Server
```bash
npm run build
```

### 4. Configure VS Code MCP

**Option A: Workspace-specific (recommended for testing)**

Create `.vscode/mcp.json` in your project:
```json
{
  "servers": {
    "ai-collaboration": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/ai-collaboration-mcp-server/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your_key_here",
        "OPENAI_API_KEY": "your_key_here",
        "GEMINI_API_KEY": "your_key_here",
        "OLLAMA_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

**Option B: Global configuration (for all projects)**

Create `~/.vscode/mcp.json`:
```json
{
  "servers": {
    "ai-collaboration": {
      "type": "stdio", 
      "command": "node",
      "args": ["/absolute/path/to/ai-collaboration-mcp-server/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your_key_here",
        "OPENAI_API_KEY": "your_key_here",
        "GEMINI_API_KEY": "your_key_here",
        "OLLAMA_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

### 5. Enable MCP Auto-start (Optional)

Add to your VS Code `settings.json`:
```json
{
  "chat.mcp.autostart": "newAndOutdated"
}
```

## 🎯 Usage

1. **Restart VS Code** after configuration
2. **Open VS Code chat** (sidebar or `Cmd+Shift+I`)
3. **Use the tools:**
   - `@workspace use consult_ai with claude about my code`
   - `@workspace use multi_ai_research to compare approaches`
   - `@workspace !consult_ai` (force execution)

## 🔧 Development

### Run in Development Mode
```bash
npm run dev
```

### Test the Server
```bash
npm test
```

### Debug with MCP Inspector
```bash
npx @modelcontextprotocol/inspector node build/index.js
```

## 🧠 How It Works

### Enhanced Context Injection
Every tool call automatically includes:
- Project structure and files
- README and package.json content  
- Relevant conversation history
- Current workspace context

### Conversation History
- Persistent file-based history (`.mcp-conversation-history.json`)
- Smart relevance filtering
- Cross-session context continuity

### API Management
- Rate limiting per provider (3 calls/hour)
- Automatic retry with exponential backoff
- Clear error handling and user feedback

## 🔒 Security Notes

- API keys are stored in MCP configuration (keep them secure)
- Conversation history is stored locally
- No data sent to external services except AI provider APIs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Troubleshooting

### MCP Server Won't Start
1. Check `Cmd+Shift+P` → "MCP: List Servers"
2. Verify file paths in configuration
3. Check VS Code Output panel for errors
4. Ensure Node.js and dependencies are installed

### API Keys Not Working
1. Verify keys are correctly set in MCP configuration
2. Check for typos or extra spaces
3. Ensure keys have proper permissions

### Tools Not Appearing
1. Restart VS Code completely
2. Try `@workspace` in chat to trigger MCP loading
3. Check MCP server logs for errors

## 🌟 Why This Approach?

This streamlined server demonstrates that **smart consolidation beats feature proliferation**:

- **3 core tools** instead of 7+ specialized ones
- **Enhanced context** shared across all tools  
- **Easier maintenance** and debugging
- **Better user experience** with consistent functionality
- **Reduced cognitive load** - focus on what you want, not which tool to use

Perfect for teams wanting powerful AI collaboration without complexity!
