# 🎯 Quick Start Guide

## For Other Developers

### 1. Get the Code
```bash
git clone [your-repo-url]
cd ai-collaboration-mcp-server
npm install
npm run build
```

### 2. Set Up API Keys
```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Configure VS Code
Create `.vscode/mcp.json` in your project:
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
        "GEMINI_API_KEY": "your_key_here"
      }
    }
  }
}
```

### 4. Test It
1. Restart VS Code
2. Set workspace: `@workspace use #set_workspace with workspace_path="/path/to/your/project"`
3. Test AI: `@workspace use #consult_ai with claude about testing`

## 🛠️ The 4 Tools

- **`#consult_ai`**: Get advice from specific AI (Claude, GPT-4, Gemini, Ollama)
- **`#multi_ai_research`**: Get multiple AI perspectives on one question  
- **`#set_workspace`**: Set the current workspace for conversation history
- **`#mandatory_execute`**: Force tool execution with `!toolname` syntax

## 🎯 **Typical Workflow**

### First Time in a Project:
```
@workspace use #set_workspace with workspace_path="/full/path/to/your/project"
```

### Then Use AI Tools:
```
@workspace use #consult_ai with claude about "your question"
@workspace use #multi_ai_research about "research topic"
```

### Switch Projects:
```
@workspace use #set_workspace with workspace_path="/path/to/other/project"
```

## 📝 **Important Syntax Notes**

### With @workspace (requires #):
```
@workspace use #consult_ai with claude about "your question"
@workspace use #multi_ai_research about "research question"  
@workspace use #set_workspace with workspace_path="/path/to/project"
```

### Without @workspace (no # needed):
```
use consult_ai with claude about "your question"
use multi_ai_research about "research question"
```

**Note**: When using the `@workspace` command in VS Code, MCP tool names must be prefixed with `#` for Copilot to properly recognize them.

## ✨ What Makes This Special

- **Project-specific conversation history**: Each project gets its own `.mcp-conversation-history.json`
- **Automatic context**: Project files, README, conversation history auto-included  
- **Workspace awareness**: Correctly reads files from your current project
- **Multi-AI perspectives**: Get insights from Claude, GPT-4, Gemini, and Ollama
- **Streamlined**: 4 powerful tools that work together seamlessly

## 🆘 If It Doesn't Work

1. Check paths are absolute in MCP config
2. Verify API keys are correct
3. Restart VS Code completely
4. Check `Cmd+Shift+P` → "MCP: List Servers"

**That's it!** The MCP server provides powerful AI collaboration with minimal setup.
