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
2. Open chat and try: `@workspace use consult_ai with claude about testing`

## 🛠️ The 3 Tools

- **`consult_ai`**: Get advice from specific AI (Claude, GPT-4, Gemini, Ollama)
- **`multi_ai_research`**: Get multiple AI perspectives on one question  
- **`mandatory_execute`**: Force tool execution with `!toolname` syntax

## ✨ What Makes This Special

- **Automatic context**: Project files, README, conversation history auto-included
- **Streamlined**: 3 powerful tools instead of tool proliferation
- **Smart**: Enhanced context beats specialized tools
- **Proven**: Working in production, 56% smaller than original implementation

## 🆘 If It Doesn't Work

1. Check paths are absolute in MCP config
2. Verify API keys are correct
3. Restart VS Code completely
4. Check `Cmd+Shift+P` → "MCP: List Servers"

**That's it!** The MCP server provides powerful AI collaboration with minimal setup.
