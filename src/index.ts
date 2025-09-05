#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import fs from 'fs';
import * as fsPromises from 'fs/promises';
import fetch from "node-fetch";
import * as os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Get current file directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Debug: Log environment variables for MCP debugging
console.error("[MCP DEBUG] Environment variables received:");
console.error("ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...` : "NOT SET");
console.error("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : "NOT SET");
console.error("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.substring(0, 10)}...` : "NOT SET");
console.error("OLLAMA_BASE_URL:", process.env.OLLAMA_BASE_URL || "NOT SET");

// WORKAROUND: VS Code MCP not passing environment variables properly
// Fallback to .env file loading if environment variables are missing
if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error("[MCP WORKAROUND] Environment variables not set, attempting to load from .env file");
    // Try loading from .env file in project directory
    const envPath = path.join(__dirname, '..', '.env');
    
    if (fs.existsSync(envPath)) {
        console.error("[MCP WORKAROUND] Loading .env file from:", envPath);
        dotenv.config({ path: envPath });
        
        // Debug: Confirm variables loaded after .env file
        console.error("[MCP DEBUG] After .env loading:");
        console.error("ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...` : "STILL NOT SET");
        console.error("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : "STILL NOT SET");
        console.error("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.substring(0, 10)}...` : "STILL NOT SET");
    } else {
        console.error("[MCP WORKAROUND] .env file not found at:", envPath);
    }
}

/**
 * AI Provider Configuration
 */
interface AIProvider {
    name: string;
    model: string;
    apiKey: string;
    baseUrl: string;
    specialty: string;
}

const AI_PROVIDERS: Record<string, AIProvider> = {
    claude: {
        name: "Claude",
        model: "claude-sonnet-4-20250514",
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        baseUrl: "https://api.anthropic.com/v1/messages",
        specialty: "Analysis, reasoning, and comprehensive responses"
    },
    gpt4: {
        name: "GPT-4 (OpenAI)",
        model: "gpt-4-turbo-preview",
        apiKey: process.env.OPENAI_API_KEY || "",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        specialty: "General purpose, coding, and creative tasks"
    },
    gemini: {
        name: "Gemini Pro (Google)",
        model: "gemini-1.5-pro",
        apiKey: process.env.GEMINI_API_KEY || "",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent",
        specialty: "Multimodal understanding and research"
    },
    ollama: {
        name: "Ollama (Local)",
        model: process.env.OLLAMA_MODEL || "llama3.2:latest",
        apiKey: "", // Ollama doesn't need an API key for local usage
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        specialty: "Local AI, privacy-focused, and custom models"
    }
};

/**
 * Enhanced Context Management System
 * Handles conversation history, project context, and automatic context injection
 */
// Workspace manager for handling dynamic workspace changes
class WorkspaceManager {
    private static instance: WorkspaceManager;
    private currentWorkspace: string | null = null;
    
    static getInstance(): WorkspaceManager {
        if (!WorkspaceManager.instance) {
            WorkspaceManager.instance = new WorkspaceManager();
        }
        return WorkspaceManager.instance;
    }
    
    setWorkspace(workspacePath: string): void {
        this.currentWorkspace = workspacePath;
        console.error(`[WORKSPACE] Set workspace to: ${workspacePath}`);
    }
    
    getCurrentWorkspace(): string | null {
        return this.currentWorkspace;
    }
}

interface ConversationEntry {
    timestamp: Date;
    tool: string;
    provider: string;
    query: string;
    response: string;
    contextFiles: string[];
    tokenCount: number;
}

interface ProviderCallTracker {
    provider: string;
    calls: number;
    lastReset: Date;
    maxCalls: number;
}

interface ProjectContext {
    readme: string;
    packageJson: string;
    structure: string;
    lastUpdated: Date;
}

class ConversationHistoryManager {
    private history: ConversationEntry[] = [];
    private readonly HISTORY_FILE: string;
    private readonly MAX_HISTORY_ENTRIES = 20;
    private readonly MAX_AGE_HOURS = 24; // Only keep conversations from last 24 hours
    private readonly CONTEXT_FRESHNESS_HOURS = 6; // Consider context fresh for 6 hours

    constructor() {
        // SIMPLIFIED APPROACH: Use VS Code's current working directory
        // When VS Code opens a project, it should set CWD to that project
        const currentDir = process.cwd();
        console.error(`[CONVERSATION] Current working directory: ${currentDir}`);
        
        // Check if workspace has been dynamically set
        const dynamicWorkspace = WorkspaceManager.getInstance().getCurrentWorkspace();
        
        let workspaceDir: string;
        if (dynamicWorkspace) {
            console.error(`[CONVERSATION] Using dynamically set workspace: ${dynamicWorkspace}`);
            workspaceDir = dynamicWorkspace;
        } else if (currentDir !== os.homedir() && currentDir !== '/') {
            // If CWD is not home directory or root, use it as workspace
            console.error(`[CONVERSATION] Using current directory as workspace: ${currentDir}`);
            workspaceDir = currentDir;
        } else {
            // Fall back to detection logic only if CWD is home/root
            console.error(`[CONVERSATION] CWD is ${currentDir}, falling back to detection`);
            workspaceDir = this.findWorkspaceDirectory();
        }
        
        this.HISTORY_FILE = path.join(workspaceDir, '.mcp-conversation-history.json');
        console.error(`[CONVERSATION] Using history file: ${this.HISTORY_FILE}`);
        this.loadHistory();
    }

    private findWorkspaceDirectory(): string {
        console.error(`[CONVERSATION DEBUG] Starting from CWD: ${process.cwd()}`);
        console.error(`[CONVERSATION DEBUG] Home dir: ${os.homedir()}`);
        console.error(`[CONVERSATION DEBUG] Script path: ${process.argv[1]}`);
        
        // Method 1: Check VS Code workspace environment variables
        const vscodeWorkspaceVars = [
            'MCP_WORKSPACE_PATH',        // Custom variable we can set in mcp.json
            'VSCODE_WORKSPACE_FOLDER',   // VS Code sometimes sets this
            'WORKSPACE_FOLDER',          // Alternative VS Code variable
            'VSCODE_CWD'                 // VS Code working directory (but can be wrong)
        ];
        
        for (const envVar of vscodeWorkspaceVars) {
            const workspace = process.env[envVar];
            console.error(`[CONVERSATION DEBUG] Checking ${envVar}: ${workspace || 'undefined'}`);
            // Skip VSCODE_CWD if it's root directory - it's clearly wrong
            if (workspace && workspace !== os.homedir() && workspace !== '/' && fs.existsSync(workspace)) {
                console.error(`[CONVERSATION] Found workspace via ${envVar}: ${workspace}`);
                return workspace;
            }
        }
        
        // CRITICAL: If CWD is home directory, VS Code didn't set workspace properly
        // This is the core issue - VS Code runs MCP server with CWD=home when switching projects
        if (process.cwd() === os.homedir()) {
            console.error(`[CONVERSATION ERROR] CWD is home directory - VS Code MCP integration issue!`);
            console.error(`[CONVERSATION ERROR] Cannot reliably detect workspace from home directory`);
            console.error(`[CONVERSATION ERROR] This will cause conversation history to save in wrong location`);
            
            // Try to get workspace from VS Code's recently opened workspaces
            const recentWorkspace = this.getRecentVSCodeWorkspace();
            if (recentWorkspace) {
                console.error(`[CONVERSATION] Using recent VS Code workspace: ${recentWorkspace}`);
                return recentWorkspace;
            }
        }
        
        // Method 2: Analyze script path to infer project directory (MOST RELIABLE)
        const scriptPath = process.argv[1]; // The index.js file path
        console.error(`[CONVERSATION DEBUG] Script path: ${scriptPath}`);
        if (scriptPath) {
            // If script is in a project (e.g., /path/to/project/mcp-server/build/index.js)
            let projectDir = path.dirname(scriptPath); // /path/to/project/mcp-server/build
            
            // Go up directories looking for project indicators
            // Start by going up to the MCP server directory, then check its parent
            for (let i = 0; i < 4; i++) { // Check up to 4 levels up
                const parentDir = path.dirname(projectDir);
                console.error(`[CONVERSATION DEBUG] Checking parent dir: ${parentDir}`);
                
                // Prefer broader workspace over narrow MCP server directory
                // If current dir is valid but parent is also valid, choose parent
                if (this.isValidWorkspace(parentDir)) {
                    // Check if parent seems like a broader workspace
                    const currentDirName = path.basename(projectDir);
                    const parentDirName = path.basename(parentDir);
                    
                    // If current directory looks like an MCP server directory, prefer parent
                    if (currentDirName.includes('mcp') || currentDirName.includes('server')) {
                        console.error(`[CONVERSATION] Detected workspace from script path (parent preferred): ${parentDir}`);
                        return parentDir;
                    }
                }
                
                if (this.isValidWorkspace(projectDir)) {
                    console.error(`[CONVERSATION] Detected workspace from script path: ${projectDir}`);
                    return projectDir;
                }
                
                projectDir = parentDir;
            }
        }
        
        // Method 3: Search upward from current directory for workspace indicators
        let currentDir = process.cwd();
        const maxDepth = 10; // Prevent infinite loops
        let depth = 0;

        while (depth < maxDepth) {
            if (this.isValidWorkspace(currentDir)) {
                console.error(`[CONVERSATION] Found workspace at: ${currentDir}`);
                return currentDir;
            }

            // Move up one directory
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                // Reached root directory
                break;
            }
            currentDir = parentDir;
            depth++;
        }

        // Method 4: If we're in home directory, try to find a reasonable default
        if (process.cwd() === os.homedir()) {
            // Look for common project directories in home
            const commonProjectDirs = [
                path.join(os.homedir(), 'Projects'),
                path.join(os.homedir(), 'projects'),
                path.join(os.homedir(), 'workspace'),
                path.join(os.homedir(), 'Development'),
                path.join(os.homedir(), 'dev')
            ];
            
            for (const projectsDir of commonProjectDirs) {
                if (fs.existsSync(projectsDir)) {
                    console.error(`[CONVERSATION] Found projects directory: ${projectsDir}, but no specific project detected`);
                    // Don't return this - it's too broad
                    break;
                }
            }
        }

        // Fallback to current working directory
        console.error(`[CONVERSATION] No workspace found, using CWD: ${process.cwd()}`);
        const fallbackDir = process.cwd();
        console.error(`[CONVERSATION DEBUG] Final workspace path will be: ${path.join(fallbackDir, '.mcp-conversation-history.json')}`);
        return fallbackDir;
    }

    private getRecentVSCodeWorkspace(): string | null {
        try {
            // Method 1: Try to read VS Code's current workspace from storage
            const vscodeDir = path.join(os.homedir(), 'Library/Application Support/Code/User');
            const recentlyOpenedPath = path.join(vscodeDir, 'globalStorage/storage.json');
            
            if (fs.existsSync(recentlyOpenedPath)) {
                const storage = JSON.parse(fs.readFileSync(recentlyOpenedPath, 'utf8'));
                const recentlyOpened = storage?.['history.recentlyOpenedPathsList'];
                
                if (recentlyOpened?.entries && Array.isArray(recentlyOpened.entries)) {
                    // Get the most recently opened folder (not file)
                    for (const entry of recentlyOpened.entries) {
                        if (entry.folderUri && entry.folderUri.startsWith('file://')) {
                            const workspacePath = entry.folderUri.replace('file://', '');
                            if (fs.existsSync(workspacePath) && this.isValidWorkspace(workspacePath)) {
                                console.error(`[CONVERSATION] Found recent workspace: ${workspacePath}`);
                                return workspacePath;
                            }
                        }
                    }
                }
            }
            
            // Method 2: Try to read from VS Code's workspace state
            const workspaceStoragePath = path.join(vscodeDir, 'workspaceStorage');
            if (fs.existsSync(workspaceStoragePath)) {
                const workspaceDirs = fs.readdirSync(workspaceStoragePath);
                
                // Find the most recently modified workspace directory
                let mostRecentWorkspace = null;
                let mostRecentTime = 0;
                
                for (const workspaceDir of workspaceDirs) {
                    const workspacePath = path.join(workspaceStoragePath, workspaceDir);
                    const workspaceJsonPath = path.join(workspacePath, 'workspace.json');
                    
                    if (fs.existsSync(workspaceJsonPath)) {
                        const stats = fs.statSync(workspaceJsonPath);
                        if (stats.mtime.getTime() > mostRecentTime) {
                            try {
                                const workspaceConfig = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'));
                                if (workspaceConfig.folder) {
                                    const folderPath = workspaceConfig.folder.replace('file://', '');
                                    if (fs.existsSync(folderPath) && this.isValidWorkspace(folderPath)) {
                                        mostRecentWorkspace = folderPath;
                                        mostRecentTime = stats.mtime.getTime();
                                    }
                                }
                            } catch (error) {
                                // Skip invalid workspace files
                            }
                        }
                    }
                }
                
                if (mostRecentWorkspace) {
                    console.error(`[WORKSPACE] Found current workspace from storage: ${mostRecentWorkspace}`);
                    return mostRecentWorkspace;
                }
            }
        } catch (error) {
            console.error(`[CONVERSATION] Error reading VS Code workspace: ${error}`);
        }
        
        return null;
    }

    private isValidWorkspace(dirPath: string): boolean {
        if (!fs.existsSync(dirPath)) return false;
        
        // Check for common workspace/project indicators
        const indicators = [
            'package.json',
            '.git',
            '.vscode',
            'tsconfig.json',
            'README.md',
            'Cargo.toml',
            'go.mod',
            'requirements.txt',
            'pom.xml',
            '.gitignore'
        ];

        return indicators.some(indicator => 
            fs.existsSync(path.join(dirPath, indicator))
        );
    }

    async addEntry(entry: Omit<ConversationEntry, 'timestamp'>): Promise<void> {
        const newEntry: ConversationEntry = {
            ...entry,
            timestamp: new Date()
        };
        
        console.error(`[CONVERSATION DEBUG] Adding entry: ${entry.tool} - ${entry.query.substring(0, 50)}...`);
        this.history.unshift(newEntry);
        
        // Keep only recent entries to prevent memory bloat
        if (this.history.length > this.MAX_HISTORY_ENTRIES) {
            this.history = this.history.slice(0, this.MAX_HISTORY_ENTRIES);
        }
        
        console.error(`[CONVERSATION DEBUG] About to persist to: ${this.HISTORY_FILE}`);
        await this.persistHistory();
        console.error(`[CONVERSATION DEBUG] Persist completed`);
    }

    getRelevantHistory(query: string, tool: string, maxEntries: number = 5): ConversationEntry[] {
        // First get fresh entries, then filter by relevance
        const freshEntries = this.getRecentHistory(10); // Get more fresh entries for filtering
        const keywords = this.extractKeywords(query);
        
        return freshEntries
            .filter(entry => {
                // Include same-tool conversations with higher priority
                const toolMatch = entry.tool === tool ? 2 : 1;
                
                // Check for keyword relevance
                const contentRelevance = this.calculateRelevance(
                    entry.query + ' ' + entry.response, 
                    keywords
                );
                
                return (toolMatch * contentRelevance) > 0.3; // Relevance threshold
            })
            .slice(0, maxEntries);
    }

    private extractKeywords(text: string): string[] {
        return text.toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 3)
            .filter(word => !['that', 'this', 'with', 'from', 'they', 'were', 'been', 'have', 'will', 'would', 'could', 'should'].includes(word));
    }

    private calculateRelevance(content: string, keywords: string[]): number {
        const contentLower = content.toLowerCase();
        const matches = keywords.filter(keyword => contentLower.includes(keyword));
        return matches.length / Math.max(keywords.length, 1);
    }

    private async loadHistory(): Promise<void> {
        try {
            if (fs.existsSync(this.HISTORY_FILE)) {
                const data = await fsPromises.readFile(this.HISTORY_FILE, 'utf8');
                const allEntries = JSON.parse(data).map((entry: any) => ({
                    ...entry,
                    timestamp: new Date(entry.timestamp)
                }));
                
                // Filter out old entries to prevent stale context
                const cutoffDate = new Date();
                cutoffDate.setHours(cutoffDate.getHours() - this.MAX_AGE_HOURS);
                
                this.history = allEntries.filter((entry: ConversationEntry) => 
                    entry.timestamp > cutoffDate
                );
                
                console.error(`[CONVERSATION] Loaded ${this.history.length} recent conversation entries (filtered from ${allEntries.length} total)`);
                
                // If we filtered out entries, persist the cleaned history
                if (allEntries.length !== this.history.length) {
                    await this.persistHistory();
                    console.error(`[CONVERSATION] Cleaned up ${allEntries.length - this.history.length} old entries`);
                }
            }
        } catch (error) {
            console.error('[CONVERSATION] Failed to load conversation history:', error);
            this.history = [];
        }
    }

    private async persistHistory(): Promise<void> {
        try {
            console.error(`[CONVERSATION DEBUG] Persisting ${this.history.length} entries to: ${this.HISTORY_FILE}`);
            await fsPromises.writeFile(
                this.HISTORY_FILE, 
                JSON.stringify(this.history, null, 2)
            );
            console.error(`[CONVERSATION DEBUG] Successfully persisted conversation history`);
        } catch (error) {
            console.error('[CONVERSATION] Failed to persist conversation history:', error);
        }
    }

    getRecentHistory(limit: number = 10): ConversationEntry[] {
        // Only return entries from recent hours to ensure freshness
        const freshnessCutoff = new Date();
        freshnessCutoff.setHours(freshnessCutoff.getHours() - this.CONTEXT_FRESHNESS_HOURS);
        
        const freshEntries = this.history.filter(entry => entry.timestamp > freshnessCutoff);
        return freshEntries.slice(0, limit);
    }

    getContextSummary(): string {
        const recentEntries = this.getRecentHistory(5);
        if (recentEntries.length === 0) {
            return "No recent conversation history in this workspace.";
        }
        
        const summary = recentEntries.map(entry => {
            const timeAgo = Math.round((Date.now() - entry.timestamp.getTime()) / (1000 * 60));
            return `${timeAgo}m ago: ${entry.tool} (${entry.provider}) - "${entry.query.substring(0, 100)}..."`;
        }).join('\n');
        
        return `Recent conversation context (last ${this.CONTEXT_FRESHNESS_HOURS}h):\n${summary}`;
    }
}

class ContextManager {
    private projectContext: ProjectContext | null = null;
    private readonly MAX_CONTEXT_TOKENS = 8000; // Conservative limit for most providers
    private readonly PROJECT_CONTEXT_TTL = 5 * 60 * 1000; // 5 minutes

    async getProjectContext(): Promise<ProjectContext> {
        if (this.projectContext && 
            Date.now() - this.projectContext.lastUpdated.getTime() < this.PROJECT_CONTEXT_TTL) {
            return this.projectContext;
        }

        // Refresh project context
        try {
            // Get the current workspace directory
            const workspaceDir = this.getCurrentWorkspaceDir();
            console.error(`[CONTEXT] Loading project context from: ${workspaceDir}`);
            
            const readme = await this.readFileIfExists(path.join(workspaceDir, 'README.md'));
            const packageJson = await this.readFileIfExists(path.join(workspaceDir, 'package.json'));
            const structure = await this.getProjectStructure(workspaceDir);

            this.projectContext = {
                readme: readme || 'No README.md found',
                packageJson: packageJson || 'No package.json found',
                structure: structure || 'Could not determine project structure',
                lastUpdated: new Date()
            };

            console.error('[CONTEXT] Refreshed project context');
            return this.projectContext;
        } catch (error) {
            console.error('[CONTEXT] Failed to load project context:', error);
            return {
                readme: 'Error loading README.md',
                packageJson: 'Error loading package.json',
                structure: 'Error determining project structure',
                lastUpdated: new Date()
            };
        }
    }

    async discoverRelevantFiles(query: string): Promise<string[]> {
        const keywords = query.toLowerCase().split(/\s+/);
        const relevantFiles: string[] = [];
        
        try {
            // Look for specific file mentions in the query
            const fileExtensions = ['.ts', '.js', '.json', '.md', '.py', '.java', '.go', '.rs'];
            for (const ext of fileExtensions) {
                if (query.includes(ext)) {
                    // Find files with this extension
                    const files = await this.findFilesByExtension(ext);
                    relevantFiles.push(...files.slice(0, 3)); // Limit to 3 files per extension
                }
            }

            // Look for keyword matches in common config files
            const configFiles = ['tsconfig.json', '.env.example', 'package-lock.json'];
            for (const file of configFiles) {
                if (keywords.some(keyword => file.toLowerCase().includes(keyword))) {
                    if (await this.fileExists(file)) {
                        relevantFiles.push(file);
                    }
                }
            }

        } catch (error) {
            console.error('[CONTEXT] Error discovering relevant files:', error);
        }

        return [...new Set(relevantFiles)]; // Remove duplicates
    }

    async buildFullContext(query: string, tool: string, conversationHistory: ConversationHistoryManager): Promise<string> {
        const projectContext = await this.getProjectContext();
        const relevantFiles = await this.discoverRelevantFiles(query);
        const fileContents = await this.readRelevantFileContents(relevantFiles);
        
        // Get only fresh conversation history to prevent stale context
        const freshHistory = conversationHistory.getRecentHistory(5);
        
        let context = `# PROJECT CONTEXT

## Project Overview
${this.summarizeProject(projectContext)}

## Relevant Files
${fileContents}

## Recent Conversation History
${this.formatConversationHistory(freshHistory)}

## Current Query
Tool: ${tool}
Query: ${query}

---

`;

        // Check token limits and truncate if necessary
        if (this.estimateTokenCount(context) > this.MAX_CONTEXT_TOKENS) {
            context = this.truncateContext(context);
        }

        return context;
    }

    public clearProjectContext(): void {
        this.projectContext = null;
        console.error('[CONTEXT] Cleared cached project context');
    }

    estimateTokenCount(text: string): number {
        // Rough estimate: ~4 characters per token
        return Math.ceil(text.length / 4);
    }

    private getCurrentWorkspaceDir(): string {
        // Get workspace from WorkspaceManager if set
        const dynamicWorkspace = WorkspaceManager.getInstance().getCurrentWorkspace();
        if (dynamicWorkspace) {
            console.error(`[CONTEXT] Using workspace from WorkspaceManager: ${dynamicWorkspace}`);
            return dynamicWorkspace;
        }
        
        // Final fallback to current working directory
        console.error(`[CONTEXT] No workspace set, using CWD: ${process.cwd()}`);
        return process.cwd();
    }

    private async readFileIfExists(filePath: string): Promise<string | null> {
        try {
            return await fsPromises.readFile(filePath, 'utf8');
        } catch {
            return null;
        }
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fsPromises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async getProjectStructure(workspaceDir: string = process.cwd()): Promise<string> {
        try {
            // Simple project structure - just list main directories and files
            console.error(`[CONTEXT] Reading project structure from: ${workspaceDir}`);
            const items = await fsPromises.readdir(workspaceDir, { withFileTypes: true });
            const structure = items
                .filter(item => !item.name.startsWith('.') || ['.github', '.vscode'].includes(item.name))
                .map(item => item.isDirectory() ? `${item.name}/` : item.name)
                .sort()
                .join('\n');
            
            return structure;
        } catch (error) {
            console.error(`[CONTEXT] Error reading project structure from ${workspaceDir}:`, error);
            return 'Error reading project structure';
        }
    }

    private async findFilesByExtension(extension: string): Promise<string[]> {
        try {
            const items = await fsPromises.readdir('.', { withFileTypes: true, recursive: true });
            return items
                .filter(item => item.isFile() && item.name.endsWith(extension))
                .map(item => item.name)
                .slice(0, 5); // Limit results
        } catch {
            return [];
        }
    }

    private async readRelevantFileContents(filePaths: string[]): Promise<string> {
        const contents: string[] = [];
        
        for (const filePath of filePaths.slice(0, 3)) { // Limit to 3 files
            try {
                const content = await fsPromises.readFile(filePath, 'utf8');
                contents.push(`### ${filePath}
\`\`\`
${content.slice(0, 1000)}${content.length > 1000 ? '\n... (truncated)' : ''}
\`\`\``);
            } catch (error) {
                contents.push(`### ${filePath}
Error reading file: ${error}`);
            }
        }

        return contents.length > 0 ? contents.join('\n\n') : 'No relevant files found';
    }

    private summarizeProject(context: ProjectContext): string {
        return `**Package Info:**
${context.packageJson.slice(0, 500)}${context.packageJson.length > 500 ? '... (truncated)' : ''}

**README:**
${context.readme.slice(0, 800)}${context.readme.length > 800 ? '... (truncated)' : ''}

**Project Structure:**
${context.structure}`;
    }

    private formatConversationHistory(history: ConversationEntry[]): string {
        if (history.length === 0) return 'No previous conversation history';
        
        return history.map(entry => 
            `**${entry.tool}** (${entry.provider}) - ${entry.timestamp.toISOString()}:
Q: ${entry.query.slice(0, 200)}${entry.query.length > 200 ? '...' : ''}
A: ${entry.response.slice(0, 300)}${entry.response.length > 300 ? '...' : ''}
`
        ).join('\n');
    }

    private truncateContext(context: string): string {
        const targetLength = this.MAX_CONTEXT_TOKENS * 4; // Convert back to characters
        if (context.length <= targetLength) return context;
        
        // Keep the project context and current query, truncate conversation history
        const sections = context.split('## Recent Conversation History');
        if (sections.length === 2) {
            const beforeHistory = sections[0];
            const afterHistory = sections[1].split('## Current Query');
            if (afterHistory.length === 2) {
                const truncatedHistory = '## Recent Conversation History\n(Conversation history truncated due to length)\n\n## Current Query' + afterHistory[1];
                return beforeHistory + truncatedHistory;
            }
        }
        
        // Fallback: simple truncation
        return context.slice(0, targetLength) + '\n... (context truncated due to length)';
    }
}

class ProviderCallManager {
    private callTrackers: Map<string, ProviderCallTracker> = new Map();
    private readonly MAX_CALLS_PER_PROVIDER = 3;
    private readonly RESET_INTERVAL = 60 * 60 * 1000; // 1 hour

    constructor() {
        // Initialize trackers for all providers
        Object.keys(AI_PROVIDERS).forEach(provider => {
            this.callTrackers.set(provider, {
                provider,
                calls: 0,
                lastReset: new Date(),
                maxCalls: this.MAX_CALLS_PER_PROVIDER
            });
        });
    }

    canMakeCall(provider: string): boolean {
        const tracker = this.callTrackers.get(provider);
        if (!tracker) return false;

        // Reset if enough time has passed
        if (Date.now() - tracker.lastReset.getTime() > this.RESET_INTERVAL) {
            tracker.calls = 0;
            tracker.lastReset = new Date();
        }

        return tracker.calls < tracker.maxCalls;
    }

    recordCall(provider: string): void {
        const tracker = this.callTrackers.get(provider);
        if (tracker) {
            tracker.calls++;
            console.error(`[API LIMITS] ${provider}: ${tracker.calls}/${tracker.maxCalls} calls used`);
        }
    }

    getRemainingCalls(provider: string): number {
        const tracker = this.callTrackers.get(provider);
        if (!tracker) return 0;

        // Reset if enough time has passed
        if (Date.now() - tracker.lastReset.getTime() > this.RESET_INTERVAL) {
            tracker.calls = 0;
            tracker.lastReset = new Date();
        }

        return Math.max(0, tracker.maxCalls - tracker.calls);
    }

    getCallStatus(): Record<string, { remaining: number; total: number }> {
        const status: Record<string, { remaining: number; total: number }> = {};
        
        this.callTrackers.forEach((tracker, provider) => {
            status[provider] = {
                remaining: this.getRemainingCalls(provider),
                total: tracker.maxCalls
            };
        });

        return status;
    }
}

/**
 * Streamlined AI Collaboration MCP Server
 * 
 * This server provides essential AI collaboration tools with enhanced context and conversation history.
 * Focus: consult_ai, multi_ai_research, and mandatory_execute for core functionality.
 */
class AICollaborationServer {
    private server: Server;
    private conversationHistory: ConversationHistoryManager;
    private contextManager: ContextManager;
    private providerCallManager: ProviderCallManager;

    constructor() {
        this.server = new Server(
            {
                name: "ai-collaboration-mcp",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                },
            }
        );

        // Initialize enhanced context management
        this.conversationHistory = new ConversationHistoryManager();
        this.contextManager = new ContextManager();
        this.providerCallManager = new ProviderCallManager();

        this.setupToolHandlers();
        this.setupResourceHandlers();
        
        // Error handling
        this.server.onerror = (error) => {
            console.error("[MCP Error]", error);
        };

        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    /**
     * Retry utility with exponential backoff for API calls
     */
    private async retryWithBackoff<T>(
        operation: () => Promise<T>, 
        maxRetries: number = 3,
        baseDelay: number = 200
    ): Promise<T> {
        let lastError: Error = new Error("Unknown error");
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                
                // Don't retry on authentication errors or client errors
                if (error instanceof Error) {
                    const errorMessage = error.message.toLowerCase();
                    if (errorMessage.includes('401') || errorMessage.includes('403') || 
                        errorMessage.includes('invalid api key') || errorMessage.includes('unauthorized')) {
                        throw error;
                    }
                }
                
                if (attempt === maxRetries) {
                    break;
                }
                
                // Exponential backoff: 200ms, 400ms, 800ms
                const delay = baseDelay * Math.pow(2, attempt);
                console.error(`[MCP RETRY] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }

    /**
     * Command Parser for Mandatory Tool Execution
     */
    private parseAndExecuteCommand(userMessage: string, toolName: string, args: any): boolean {
        // Define command patterns that trigger mandatory execution
        const mandatoryPatterns = [
            /^use\s+(\w+)/i,           // "use ai_supervisor"
            /^execute\s+(\w+)/i,       // "execute ai_supervisor"
            /^run\s+(\w+)/i,           // "run ai_supervisor"
            /^call\s+(\w+)/i,          // "call ai_supervisor"
            /!(\w+)/,                  // "!ai_supervisor" (explicit trigger)
        ];

        // Check if any mandatory pattern matches
        for (const pattern of mandatoryPatterns) {
            const match = userMessage.match(pattern);
            if (match && match[1] === toolName) {
                console.error(`[MANDATORY EXECUTION] Triggered for tool: ${toolName}`);
                return true; // Force execution
            }
        }

        return false; // Optional execution
    }

    private setupToolHandlers() {
        // List available tools - streamlined to just the essentials
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "consult_ai",
                        description: "Consult with a specific AI provider for expertise in their specialty area. Enhanced with automatic project context and conversation history.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                provider: {
                                    type: "string",
                                    enum: Object.keys(AI_PROVIDERS),
                                    description: "Which AI provider to consult (claude, gpt4, gemini, ollama)"
                                },
                                prompt: {
                                    type: "string",
                                    description: "The question or task to ask the AI provider"
                                },
                                context: {
                                    type: "string",
                                    description: "Additional context for the consultation (optional - automatic context injection will also include project info)"
                                }
                            },
                            required: ["provider", "prompt"]
                        }
                    },
                    {
                        name: "multi_ai_research",
                        description: "Get perspectives from multiple AI providers on a research question. Enhanced with full project context and conversation history shared across all providers.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                research_question: {
                                    type: "string",
                                    description: "The research question to investigate"
                                },
                                providers: {
                                    type: "array",
                                    items: {
                                        type: "string",
                                        enum: Object.keys(AI_PROVIDERS)
                                    },
                                    description: "Which AI providers to consult (default: all available)"
                                }
                            },
                            required: ["research_question"]
                        }
                    },
                    {
                        name: "mandatory_execute",
                        description: "Enforces mandatory execution of tools when explicitly requested. Use syntax: !toolname or 'use toolname'",
                        inputSchema: {
                            type: "object",
                            properties: {
                                command: {
                                    type: "string",
                                    description: "The user's exact command that triggered mandatory execution"
                                },
                                tool_name: {
                                    type: "string",
                                    description: "The name of the tool to execute mandatorily"
                                },
                                tool_args: {
                                    type: "object",
                                    description: "Arguments to pass to the tool"
                                }
                            },
                            required: ["command", "tool_name"]
                        }
                    },
                    {
                        name: "set_workspace",
                        description: "Set the current workspace directory for conversation history. This should be called when VS Code switches to a different project.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                workspace_path: {
                                    type: "string",
                                    description: "The absolute path to the current workspace/project directory"
                                }
                            },
                            required: ["workspace_path"]
                        }
                    }
                ]
            };
        });

        // Handle tool calls - only the essential tools
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                // CRITICAL: Extract workspace from VS Code context if available
                // When VS Code uses @workspace, it should provide context about the current workspace
                const workspaceFromContext = this.extractWorkspaceFromRequest(request);
                if (workspaceFromContext) {
                    console.error(`[WORKSPACE] Auto-detected workspace from VS Code context: ${workspaceFromContext}`);
                    WorkspaceManager.getInstance().setWorkspace(workspaceFromContext);
                    // Reinitialize conversation history with correct workspace
                    this.conversationHistory = new ConversationHistoryManager();
                }
                
                switch (request.params.name) {
                    case "consult_ai":
                        return await this.consultAI(request.params.arguments);
                    
                    case "multi_ai_research":
                        return await this.multiAIResearch(request.params.arguments);
                    
                    case "mandatory_execute":
                        return await this.mandatoryExecute(request.params.arguments);
                    
                    case "set_workspace":
                        return await this.setWorkspace(request.params.arguments);
                    
                    default:
                        throw new Error(`Unknown tool: ${request.params.name}`);
                }
            } catch (error) {
                console.error("Tool execution error:", error);
                throw error;
            }
        });
    }

    private setupResourceHandlers() {
        // List available resources
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            return {
                resources: [
                    {
                        uri: "ai-providers://status",
                        name: "AI Providers Status",
                        description: "Status and configuration of all AI providers",
                        mimeType: "text/plain"
                    },
                    {
                        uri: "ai-providers://capabilities",
                        name: "AI Provider Capabilities",
                        description: "Detailed capabilities and specialties of each AI provider",
                        mimeType: "application/json"
                    }
                ]
            };
        });

        // Handle resource requests
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const uri = request.params.uri;

            if (uri === "ai-providers://status") {
                const status = Object.entries(AI_PROVIDERS).map(([key, provider]) => {
                    const callStatus = this.providerCallManager.getCallStatus()[key];
                    return `${provider.name}: ${provider.apiKey ? '✅ Configured' : '❌ Missing API Key'} (${callStatus.remaining}/${callStatus.total} calls remaining)`;
                }).join('\n');

                return {
                    contents: [
                        {
                            uri,
                            mimeType: "text/plain",
                            text: status
                        }
                    ]
                };
            } else if (uri === "ai-providers://capabilities") {
                return {
                    contents: [
                        {
                            uri,
                            mimeType: "application/json",
                            text: JSON.stringify(AI_PROVIDERS, null, 2)
                        }
                    ]
                };
            } else {
                throw new Error(`Unknown resource: ${uri}`);
            }
        });
    }

    private async consultAI(args: any): Promise<any> {
        const { provider, prompt, context } = args;
        const toolName = 'consult_ai';
        
        if (!AI_PROVIDERS[provider]) {
            throw new Error(`Unknown AI provider: ${provider}`);
        }

        const aiProvider = AI_PROVIDERS[provider];
        
        if (!aiProvider.apiKey) {
            throw new Error(`API key not configured for ${aiProvider.name}`);
        }

        // Check API call limits
        if (!this.providerCallManager.canMakeCall(provider)) {
            const remaining = this.providerCallManager.getRemainingCalls(provider);
            return {
                content: [
                    {
                        type: "text",
                        text: `## ❌ API Call Limit Reached for ${aiProvider.name}\n\n**Limit:** 3 calls per hour\n**Remaining:** ${remaining}\n\n**Suggestion:** Wait for limit reset or use a different provider.`
                    }
                ]
            };
        }

        try {
            // Build enhanced context with conversation history and project context
            const enhancedContext = await this.contextManager.buildFullContext(prompt, toolName, this.conversationHistory);
            
            // Combine user-provided context with enhanced context
            const fullPrompt = context 
                ? `${enhancedContext}\n\n## Additional User Context\n${context}\n\n## Final Query\n${prompt}`
                : `${enhancedContext}\n\n## Final Query\n${prompt}`;
            
            console.error(`[CONSULT_AI] Calling ${aiProvider.name} with enhanced context (${this.contextManager.estimateTokenCount(fullPrompt)} estimated tokens)`);
            
            const response = await this.callAIProvider(aiProvider, fullPrompt);
            
            // Record the API call
            this.providerCallManager.recordCall(provider);
            
            // Store in conversation history
            await this.conversationHistory.addEntry({
                tool: toolName,
                provider: provider,
                query: prompt,
                response: response,
                contextFiles: [],
                tokenCount: this.contextManager.estimateTokenCount(fullPrompt + response)
            });
            
            const callStatus = this.providerCallManager.getCallStatus();
            
            return {
                content: [
                    {
                        type: "text",
                        text: `## Consultation with ${aiProvider.name}\n\n**Specialty:** ${aiProvider.specialty}\n**Remaining API calls:** ${callStatus[provider].remaining}/${callStatus[provider].total}\n\n**Response:**\n\n${response}`
                    }
                ]
            };
        } catch (error) {
            console.error(`[consultAI] Error consulting ${aiProvider.name}:`, error);
            return {
                content: [
                    {
                        type: "text",
                        text: `## ❌ Error consulting ${aiProvider.name}\n\n**Error:** ${error}\n\n**Suggestion:** Check API key configuration and try again.`
                    }
                ]
            };
        }
    }

    private async multiAIResearch(args: any): Promise<any> {
        const { research_question, providers = Object.keys(AI_PROVIDERS) } = args;
        const toolName = 'multi_ai_research';
        
        // Build enhanced context once for all providers
        const enhancedContext = await this.contextManager.buildFullContext(research_question, toolName, this.conversationHistory);
        
        const results: string[] = [];
        const responses: Array<{ provider: string; response: string }> = [];
        
        console.error(`[MULTI_AI_RESEARCH] Starting research with enhanced context (${this.contextManager.estimateTokenCount(enhancedContext)} estimated tokens)`);
        
        for (const providerKey of providers) {
            if (!AI_PROVIDERS[providerKey]) {
                continue;
            }
            
            const provider = AI_PROVIDERS[providerKey];
            
            if (!provider.apiKey) {
                results.push(`**${provider.name}:** ❌ API key not configured`);
                continue;
            }

            // Check API call limits
            if (!this.providerCallManager.canMakeCall(providerKey)) {
                const remaining = this.providerCallManager.getRemainingCalls(providerKey);
                results.push(`**${provider.name}:** ❌ API call limit reached (${remaining} remaining)`);
                continue;
            }
            
            try {
                const fullPrompt = `${enhancedContext}\n\n## Final Research Question\n${research_question}`;
                
                console.error(`[MULTI_AI_RESEARCH] Querying ${provider.name}...`);
                const response = await this.callAIProvider(provider, fullPrompt);
                
                // Record the API call
                this.providerCallManager.recordCall(providerKey);
                
                responses.push({ provider: providerKey, response });
                
                const remaining = this.providerCallManager.getRemainingCalls(providerKey);
                results.push(`**${provider.name}** (${provider.specialty}) - ${remaining}/3 calls remaining:\n\n${response}\n\n---\n`);
            } catch (error) {
                console.error(`[MULTI_AI_RESEARCH] Error with ${provider.name}:`, error);
                results.push(`**${provider.name}:** ❌ Error: ${error}\n\n---\n`);
            }
        }

        // Store conversation history for successful responses
        if (responses.length > 0) {
            const combinedResponse = responses.map(r => `${AI_PROVIDERS[r.provider].name}: ${r.response}`).join('\n\n');
            await this.conversationHistory.addEntry({
                tool: toolName,
                provider: 'multiple',
                query: research_question,
                response: combinedResponse,
                contextFiles: [],
                tokenCount: this.contextManager.estimateTokenCount(enhancedContext + combinedResponse)
            });
        }
        
        // Store conversation history for successful responses
        const successfulResponses = responses.filter(r => !r.response.includes('❌'));
        if (successfulResponses.length > 0) {
            try {
                await this.conversationHistory.addEntry({
                    tool: toolName,
                    provider: 'multiple',
                    query: research_question,
                    response: results.join('\n'),
                    contextFiles: [],
                    tokenCount: this.contextManager.estimateTokenCount(research_question + results.join('\n'))
                });
            } catch (error) {
                console.error('[MULTI_AI_RESEARCH] Failed to save conversation history:', error);
            }
        }
        
        return {
            content: [
                {
                    type: "text",
                    text: `# Multi-AI Research Results\n\n**Research Question:** ${research_question}\n\n${results.join('\n')}`
                }
            ]
        };
    }

    private async mandatoryExecute(args: any): Promise<any> {
        const { command, tool_name, tool_args = {} } = args;
        
        console.error(`[MANDATORY EXECUTE] Command: "${command}" Tool: "${tool_name}"`);
        
        // Validate that this is indeed a mandatory execution request
        if (!this.parseAndExecuteCommand(command, tool_name, tool_args)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ **Mandatory Execution Failed**\n\nCommand "${command}" does not match mandatory execution patterns.\n\n**Valid patterns:**\n- \`use ${tool_name}\`\n- \`execute ${tool_name}\`\n- \`run ${tool_name}\`\n- \`!${tool_name}\`\n\nPlease use proper syntax for mandatory tool execution.`
                    }
                ]
            };
        }
        
        // Execute the requested tool directly
        try {
            // Use the same routing logic as the main tool handler
            switch (tool_name) {
                case "consult_ai":
                    return await this.consultAI(tool_args);
                case "multi_ai_research":
                    return await this.multiAIResearch(tool_args);
                default:
                    throw new Error(`Mandatory execution not supported for tool: ${tool_name}`);
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ **Mandatory Execution Error**\n\nTool: ${tool_name}\nCommand: ${command}\nError: ${error}\n\n**Suggestion:** Check tool arguments and try again.`
                    }
                ]
            };
        }
    }

    private extractWorkspaceFromRequest(request: any): string | null {
        try {
            // Check various places where VS Code might pass workspace information
            console.error(`[WORKSPACE DEBUG] Full request:`, JSON.stringify(request, null, 2));
            
            // Method 1: Check request meta/context
            if (request.meta?.workspaceFolder) {
                console.error(`[WORKSPACE] Found in request.meta.workspaceFolder: ${request.meta.workspaceFolder}`);
                return request.meta.workspaceFolder;
            }
            
            // Method 2: Check request params context
            if (request.params?.context?.workspaceFolder) {
                console.error(`[WORKSPACE] Found in request.params.context.workspaceFolder: ${request.params.context.workspaceFolder}`);
                return request.params.context.workspaceFolder;
            }
            
            // Method 3: Check arguments for workspace hints
            if (request.params?.arguments?.context) {
                const contextStr = JSON.stringify(request.params.arguments.context);
                console.error(`[WORKSPACE DEBUG] Context string: ${contextStr}`);
                
                // Look for file paths that might indicate workspace
                const filePathMatch = contextStr.match(/file:\/\/([^"]+)/);
                if (filePathMatch) {
                    const filePath = filePathMatch[1];
                    console.error(`[WORKSPACE DEBUG] Found file path: ${filePath}`);
                    
                    // Extract workspace root from file path
                    let dir = path.dirname(filePath);
                    while (dir && dir !== '/' && dir !== os.homedir()) {
                        if (this.isValidWorkspaceDir(dir)) {
                            console.error(`[WORKSPACE] Detected workspace from file path: ${dir}`);
                            return dir;
                        }
                        dir = path.dirname(dir);
                    }
                }
                
                // NEW: Try to infer workspace from context content patterns
                // Look for project-specific terms or paths that might hint at the workspace
                const contextLower = contextStr.toLowerCase();
                
                // Check for common project patterns in context
                const projectPatterns = [
                    /\/([^\/]+)\/(src|lib|components|pages|app)/i,
                    /project[:\s]+([^,\s]+)/i,
                    /workspace[:\s]+([^,\s]+)/i,
                    /working on[:\s]+([^,\s]+)/i
                ];
                
                for (const pattern of projectPatterns) {
                    const match = contextStr.match(pattern);
                    if (match && match[1]) {
                        const projectHint = match[1];
                        console.error(`[WORKSPACE DEBUG] Found project hint: ${projectHint}`);
                        
                        // Try to find this project in common locations
                        const possiblePaths = [
                            path.join(os.homedir(), 'Projects', projectHint),
                            path.join(os.homedir(), 'projects', projectHint),
                            path.join(os.homedir(), 'Development', projectHint),
                            path.join(os.homedir(), 'dev', projectHint),
                            path.join(os.homedir(), projectHint)
                        ];
                        
                        for (const possiblePath of possiblePaths) {
                            if (fs.existsSync(possiblePath) && this.isValidWorkspaceDir(possiblePath)) {
                                console.error(`[WORKSPACE] Found workspace from context hint: ${possiblePath}`);
                                return possiblePath;
                            }
                        }
                    }
                }
            }
            
            // Method 4: Check for environment variables set by this request
            const envWorkspace = process.env.VSCODE_WORKSPACE_FOLDER || process.env.WORKSPACE_FOLDER;
            if (envWorkspace && envWorkspace !== '/' && fs.existsSync(envWorkspace)) {
                console.error(`[WORKSPACE] Found in environment: ${envWorkspace}`);
                return envWorkspace;
            }
            
            console.error(`[WORKSPACE DEBUG] No workspace found in request context`);
            return null;
            
        } catch (error) {
            console.error(`[WORKSPACE ERROR] Error extracting workspace: ${error}`);
            return null;
        }
    }

    private isValidWorkspaceDir(dirPath: string): boolean {
        if (!fs.existsSync(dirPath)) return false;
        
        // Check for common workspace/project indicators
        const indicators = [
            'package.json',
            '.git',
            'pyproject.toml',
            'requirements.txt',
            'Cargo.toml',
            'pom.xml',
            'build.gradle',
            'composer.json',
            'go.mod',
            '.vscode',
            'tsconfig.json'
        ];
        
        return indicators.some(indicator => 
            fs.existsSync(path.join(dirPath, indicator))
        );
    }

    private async setWorkspace(args: any): Promise<any> {
        const { workspace_path } = args;
        
        if (!workspace_path) {
            return {
                content: [
                    {
                        type: "text",
                        text: "❌ **Set Workspace Error**\n\nMissing required parameter: workspace_path"
                    }
                ]
            };
        }
        
        if (!fs.existsSync(workspace_path)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ **Set Workspace Error**\n\nWorkspace path does not exist: ${workspace_path}`
                    }
                ]
            };
        }
        
        // Set the workspace using the WorkspaceManager
        WorkspaceManager.getInstance().setWorkspace(workspace_path);
        
        // Reinitialize the conversation history manager with the new workspace
        this.conversationHistory = new ConversationHistoryManager();
        
        // Force refresh the project context with the new workspace
        this.contextManager.clearProjectContext();
        
        console.error(`[WORKSPACE] Successfully set workspace to: ${workspace_path}`);
        
        return {
            content: [
                {
                    type: "text",
                    text: `✅ **Workspace Set Successfully**\n\nConversation history will now be saved to:\n\`${path.join(workspace_path, '.mcp-conversation-history.json')}\`\n\nAll future AI interactions will use this workspace-specific conversation history.`
                }
            ]
        };
    }

    /**
     * Core AI Provider Communication
     */
    private async callAIProvider(provider: AIProvider, prompt: string): Promise<string> {
        return await this.retryWithBackoff(async () => {
            if (provider.name.includes("Claude")) {
                return await this.callClaude(provider, prompt);
            } else if (provider.name.includes("GPT-4")) {
                return await this.callOpenAI(provider, prompt);
            } else if (provider.name.includes("Gemini")) {
                return await this.callGemini(provider, prompt);
            } else if (provider.name.includes("Ollama")) {
                return await this.callOllama(provider, prompt);
            } else {
                throw new Error(`Unsupported AI provider: ${provider.name}`);
            }
        });
    }

    private async callClaude(provider: AIProvider, prompt: string): Promise<string> {
        const response = await fetch(provider.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': provider.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: provider.model,
                max_tokens: 4000,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Claude API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;
        return data.content[0].text;
    }

    private async callOpenAI(provider: AIProvider, prompt: string): Promise<string> {
        const response = await fetch(provider.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
                model: provider.model,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 4000,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;
        return data.choices[0].message.content;
    }

    private async callGemini(provider: AIProvider, prompt: string): Promise<string> {
        const url = `${provider.baseUrl}?key=${provider.apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: prompt
                            }
                        ]
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 4000,
                    temperature: 0.7
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;
        
        if (data.candidates && data.candidates.length > 0) {
            return data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('No response from Gemini API');
        }
    }

    private async callOllama(provider: AIProvider, prompt: string): Promise<string> {
        const response = await fetch(`${provider.baseUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: provider.model,
                prompt: prompt,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;
        return data.response;
    }

    async run(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("AI Collaboration MCP Server running on stdio (streamlined version)");
    }
}

// Start the server
const server = new AICollaborationServer();
server.run().catch(console.error);
