const http = require('http');
const express = require('express');
const fs = require('fs/promises');
const { Server: SocketServer } = require('socket.io');
const path = require('path');
const cors = require('cors');
const chokidar = require('chokidar');
const os = require('os');
const pty = require('node-pty');

// Define the absolute path for the 'user' directory
const userDir = 'C:\\Users\\user\\OneDrive\\Desktop\\CodeYantra\\server\\user';

// Ensure the 'user' directory exists
fs.mkdir(userDir, { recursive: true }).catch((err) => {
    console.error(`Error creating 'user' directory: ${err.message}`);
});

// Determine the shell to use based on the operating system
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

// Spawn a new pseudo-terminal
const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color', // Terminal type
    cols: 80, // Number of columns
    rows: 30, // Number of rows
    cwd: userDir, // Current working directory
    env: process.env, // Environment variables
});

// Create an Express application
const app = express();

// Create an HTTP server
const server = http.createServer(app);

// Create a new Socket.IO server with CORS enabled
const io = new SocketServer({
    cors: {
        origin: '*', // Allow all origins
        methods: ['GET', 'POST', 'DELETE'],
    },
});

// Enable CORS and JSON body parsing
app.use(cors());
app.use(express.json());

// Attach the Socket.IO server to the HTTP server
io.attach(server);

// Watch the 'user' directory for changes using Chokidar
const watcher = chokidar.watch(userDir, { persistent: true });

// Emit events when a new file is added or modified
watcher.on('add', (filePath) => {
    const relativePath = path.relative(userDir, filePath);
    io.emit('file:added', relativePath);
    console.log(`File added: ${relativePath}`);
});

watcher.on('change', (filePath) => {
    const relativePath = path.relative(userDir, filePath);
    io.emit('file:changed', relativePath);
    console.log(`File changed: ${relativePath}`);
});

watcher.on('unlink', (filePath) => {
    const relativePath = path.relative(userDir, filePath);
    io.emit('file:deleted', relativePath);
    console.log(`File deleted: ${relativePath}`);
});

// Listen for data from the pseudo-terminal and emit it to the clients
ptyProcess.onData((data) => {
    io.emit('terminal:data', data);
});

// Handle new client connections
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Emit a 'file:refresh' event to the newly connected client
    socket.emit('file:refresh');

    // Handle 'file:change' events from clients to update file content
    socket.on('file:change', async ({ path: filePath, content }) => {
        try {
            const fullPath = path.join(userDir, filePath);

            // Ensure the path is within the 'user' directory
            if (!fullPath.startsWith(userDir)) {
                console.error(`Unauthorized access attempt to: ${fullPath}`);
                return;
            }

            // Ensure the path is not a directory
            const stat = await fs.stat(fullPath).catch(() => null);
            if (stat && stat.isDirectory()) {
                console.error(`Error: Attempted to write to a directory: ${fullPath}`);
                return;
            }

            // Write content to the file
            await fs.writeFile(fullPath, content, 'utf-8');
            console.log(`File updated successfully: ${fullPath}`);
        } catch (error) {
            console.error(`Error writing to file: ${error.message}`);
        }
    });

    // Handle 'terminal:write' events from clients to write data to the terminal
    socket.on('terminal:write', (data) => {
        console.log('Terminal input:', data);
        ptyProcess.write(data);
    });
});

// Endpoint to get the file tree structure of the 'user' directory
app.get('/files', async (req, res) => {
    try {
        const fileTree = await generateFileTree(userDir);
        res.json({ tree: fileTree });
    } catch (error) {
        console.error(`Error generating file tree: ${error.message}`);
        res.status(500).json({ error: 'Failed to generate file tree' });
    }
});

// Endpoint to get the content of a specific file
app.get('/files/content', async (req, res) => {
    try {
        const filePath = req.query.path;
        const fullPath = path.join(userDir, filePath);

        // Ensure the path is within the 'user' directory
        if (!fullPath.startsWith(userDir)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        // Read file content
        const content = await fs.readFile(fullPath, 'utf-8');
        res.json({ content });
    } catch (error) {
        console.error(`Error reading file content: ${error.message}`);
        res.status(404).json({ error: 'File not found or inaccessible' });
    }
});

// Endpoint to delete a file
app.delete('/files', async (req, res) => {
    try {
        const filePath = req.body.path;
        const fullPath = path.join(userDir, filePath);

        // Ensure the path is within the 'user' directory
        if (!fullPath.startsWith(userDir)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        await fs.unlink(fullPath);
        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error(`Error deleting file: ${error.message}`);
        res.status(500).json({ error: 'File deletion failed' });
    }
});

// Start the server on port 9000
server.listen(9000, () => console.log(`Server running on port 9000`));

// Function to generate a file tree structure recursively
async function generateFileTree(directory) {
    const tree = {};

    // Recursive function to build the file tree
    async function buildTree(currentDir, currentTree) {
        const files = await fs.readdir(currentDir);

        for (const file of files) {
            const filePath = path.join(currentDir, file);
            const stat = await fs.stat(filePath);

            if (stat.isDirectory()) {
                currentTree[file] = {};
                await buildTree(filePath, currentTree[file]);
            } else {
                currentTree[file] = null;
            }
        }
    }

    await buildTree(directory, tree);
    return tree;
}
//node index.js