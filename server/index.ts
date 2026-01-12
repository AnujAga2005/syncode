import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

// SECURITY FIX: Allow only your specific Frontend URL in production.
// If FRONTEND_URL is not set (e.g. on localhost), it falls back to "*"
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || "*";

app.use(cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true
}));

const server = http.createServer(app);

const io = new Server(server, {
    cors: { 
        origin: ALLOWED_ORIGIN, 
        methods: ["GET", "POST"] 
    }
});

interface RoomData {
    code: string;
    language: string;
    output: string[];
}

const rooms = new Map<string, RoomData>();
const socketRoomMap = new Map<string, string>();

io.on("connection", (socket) => {
    
    socket.on("join_room", (roomId: string) => {
        socket.join(roomId);
        socketRoomMap.set(socket.id, roomId);

        // 1. Get accurate list of users in this room from Socket.io directly
        const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        
        // 2. Broadcast accurate count to everyone
        io.to(roomId).emit("user_count", clients.length);

        // 3. Send existing room data to new user
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                code: "// Welcome to SyncCode\n// Select a language and start typing...",
                language: "javascript",
                output: ["Ready to execute..."]
            });
        }
        
        const roomData = rooms.get(roomId)!;
        io.to(socket.id).emit("sync_state", roomData);
    });

    // --- Voice Signaling ---
    socket.on("request_users", (roomId) => {
        // Send the list of *other* users to the requester
        const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        const others = clients.filter(id => id !== socket.id);
        socket.emit("all_users", others);
    });

    socket.on("sending_signal", (payload) => {
        io.to(payload.userToSignal).emit("user_joined", { signal: payload.signal, callerID: payload.callerID });
    });

    socket.on("returning_signal", (payload) => {
        io.to(payload.callerID).emit("receiving_returned_signal", { signal: payload.signal, id: socket.id });
    });

    // --- Editor Events ---
    
    // UPDATED: Now handles 'delta' to allow simultaneous typing
    socket.on("code_change", ({ roomId, code, delta }) => {
        if (rooms.has(roomId)) {
            // Update the server's master copy (for new users who join later)
            rooms.get(roomId)!.code = code;
            
            // Broadcast the change to everyone else in the room
            // We send 'delta' so they can update just that part
            // We send 'code' as a backup/sync mechanism
            socket.to(roomId).emit("receive_code", { code, delta });
        }
    });

    socket.on("language_change", ({ roomId, language }) => {
        if (rooms.has(roomId)) {
            rooms.get(roomId)!.language = language;
            socket.to(roomId).emit("receive_language", language);
        }
    });

    socket.on("output_change", ({ roomId, output }) => {
        if (rooms.has(roomId)) {
            rooms.get(roomId)!.output = output;
            socket.to(roomId).emit("receive_output", output);
        }
    });

    socket.on("disconnect", () => {
        const roomId = socketRoomMap.get(socket.id);
        if (roomId) {
            socketRoomMap.delete(socket.id);
            // Wait a moment for socket to fully leave, then update count
            setTimeout(() => {
                const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
                io.to(roomId).emit("user_count", count);
                
                // Notify voice peers to disconnect
                socket.to(roomId).emit("user_left", socket.id);

                if (count === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} closed.`);
                }
            }, 100);
        }
    });
});

// Render automatically injects the PORT environment variable.
// We must listen on THIS port, not a hardcoded one.
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`SERVER RUNNING on port ${PORT}`);
});