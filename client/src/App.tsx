import { useEffect, useState, useRef } from "react";
import io, { Socket } from "socket.io-client";
import Editor from "@monaco-editor/react";
import axios from "axios";
import SimplePeer from "simple-peer";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

const socket: Socket = io(BACKEND_URL);

type PistonResponse = {
  run: { stdout: string; stderr: string; output: string; code: number; };
};

interface PeerNode {
  peerID: string;
  peer: SimplePeer.Instance;
}

const CODE_TEMPLATES = {
  javascript: `// Welcome to SyncCode\n// Start typing your JavaScript...`,
  python: `# Welcome to SyncCode\n# Start typing your Python...`,
  java: `// Welcome to SyncCode\n\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello World");\n  }\n}`
};

const LANGUAGES = {
  javascript: { name: "JavaScript", version: "18.15.0", file: "index.js" },
  python: { name: "Python", version: "3.10.0", file: "main.py" },
  java: { name: "Java", version: "15.0.2", file: "Main.java" },
};

function App() {
  const [roomId, setRoomId] = useState<string>("");
  const [joined, setJoined] = useState<boolean>(false);
  
  const [language, setLanguage] = useState<string>("javascript");
  const [code, setCode] = useState<string>(CODE_TEMPLATES.javascript);
  const [output, setOutput] = useState<string[]>(["Ready to execute..."]);
  
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [userCount, setUserCount] = useState<number>(0);
  const isRemoteUpdate = useRef(false);

  // Voice State
  const [peers, setPeers] = useState<PeerNode[]>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [voiceActive, setVoiceActive] = useState<boolean>(false);
  const peersRef = useRef<PeerNode[]>([]);

  // --- 1. PERSISTENCE LOGIC (Fixes Refresh Issue) ---
  useEffect(() => {
    // Check URL query params on mount
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      setRoomId(roomFromUrl);
      joinRoom(roomFromUrl, false); // false = don't update URL again
    }
  }, []);

  // --- Join Logic ---
  const joinRoom = (id: string = roomId, updateUrl = true) => {
    if (id.trim() !== "") {
      socket.emit("join_room", id);
      setRoomId(id);
      setJoined(true);
      if (updateUrl) {
        const newUrl = `${window.location.pathname}?room=${id}`;
        window.history.pushState({}, "", newUrl);
      }
    }
  };

  const leaveRoom = () => {
    // disconnect socket room logic
    socket.emit("leave_room"); // Ensure server handles this if needed, or just refresh
    // Reset State
    setJoined(false);
    setRoomId("");
    setPeers([]);
    setVoiceActive(false);
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        setAudioStream(null);
    }
    // Clear URL
    window.history.pushState({}, "", window.location.pathname);
    window.location.reload(); // Force reload to ensure clean socket state
  };

  const generateRoomId = () => {
    setRoomId(crypto.randomUUID().slice(0, 8));
  };

  // --- Editor Logic ---
  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && !isRemoteUpdate.current) {
      setCode(value);
      socket.emit("code_change", { roomId, code: value });
    }
    isRemoteUpdate.current = false;
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    setLanguage(newLang);
    socket.emit("language_change", { roomId, language: newLang });

    const currentCode = code.trim();
    const isComment = currentCode.startsWith("//") || currentCode.startsWith("#");
    
    if (currentCode === "" || isComment) {
        const newCode = CODE_TEMPLATES[newLang as keyof typeof CODE_TEMPLATES];
        setCode(newCode);
        socket.emit("code_change", { roomId, code: newCode });
    }
  };

  // --- Voice Logic (Enhanced) ---
  const startVoice = () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone blocked. Ensure you are using HTTPS (Ngrok).");
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: false, audio: true })
      .then(stream => {
        setAudioStream(stream);
        setVoiceActive(true);
        socket.emit("request_users", roomId); 
      })
      .catch(err => {
        console.error("Mic Error:", err);
        alert(`Mic Error: ${err.message}`);
      });
  };

  const toggleMute = () => {
    if (audioStream) {
      const track = audioStream.getAudioTracks()[0];
      
      // 1. Toggle the hardware track
      track.enabled = !track.enabled;
      
      // 2. Update the UI state to match
      setIsMuted(!track.enabled); 
      
      // Optional: Debugging log to check if Android "ended" the track
      console.log("Mic State:", track.enabled ? "Live" : "Muted", "ReadyState:", track.readyState);
    }
  };

  // STUN Config is CRITICAL for mobile-to-laptop connection
  const createPeer = (userToSignal: string, callerID: string, stream: MediaStream) => {
    const peer = new SimplePeer({
      initiator: true,
      trickle: false,
      stream,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
    });
    peer.on("signal", signal => socket.emit("sending_signal", { userToSignal, callerID, signal }));
    return peer;
  };

  const addPeer = (incomingSignal: any, callerID: string, stream: MediaStream) => {
    const peer = new SimplePeer({
      initiator: false,
      trickle: false,
      stream,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
    });
    peer.on("signal", signal => socket.emit("returning_signal", { signal, callerID }));
    peer.signal(incomingSignal);
    return peer;
  };

  // --- Effects ---
  useEffect(() => {
    socket.on("sync_state", (state) => {
      isRemoteUpdate.current = true;
      setCode(state.code);
      setLanguage(state.language);
      setOutput(state.output);
    });

    socket.on("receive_code", (newCode) => {
      isRemoteUpdate.current = true;
      setCode(newCode);
    });
    
    socket.on("receive_language", (lang) => setLanguage(lang));
    socket.on("receive_output", (out) => setOutput(out));
    socket.on("user_count", (cnt) => setUserCount(cnt));

    socket.on("all_users", (users: string[]) => {
      if (!audioStream) return;
      const peersArr: PeerNode[] = [];
      users.forEach(userID => {
        const peer = createPeer(userID, socket.id!, audioStream);
        peersRef.current.push({ peerID: userID, peer });
        peersArr.push({ peerID: userID, peer });
      });
      setPeers(prev => [...prev, ...peersArr]);
    });

    socket.on("user_joined", (payload) => {
      if (!audioStream) return; 
      const peer = addPeer(payload.signal, payload.callerID, audioStream);
      peersRef.current.push({ peerID: payload.callerID, peer });
      setPeers(prev => [...prev, { peerID: payload.callerID, peer }]);
    });

    socket.on("receiving_returned_signal", (payload) => {
      const item = peersRef.current.find(p => p.peerID === payload.id);
      if (item) item.peer.signal(payload.signal);
    });

    socket.on("user_left", (id) => {
      const peerObj = peersRef.current.find(p => p.peerID === id);
      if (peerObj) peerObj.peer.destroy();
      const newPeers = peersRef.current.filter(p => p.peerID !== id);
      peersRef.current = newPeers;
      setPeers(newPeers);
    });

    return () => {
      socket.off("sync_state");
      socket.off("receive_code");
      socket.off("receive_language");
      socket.off("receive_output");
      socket.off("user_count");
      socket.off("all_users");
      socket.off("user_joined");
      socket.off("receiving_returned_signal");
    };
  }, [audioStream]);

  // Run & Download
  const runCode = async () => {
    setIsRunning(true);
    const temp = ["Running..."];
    setOutput(temp);
    socket.emit("output_change", { roomId, output: temp });
    try {
      const config = LANGUAGES[language as keyof typeof LANGUAGES];
      const res = await axios.post("https://emkc.org/api/v2/piston/execute", {
        language: language,
        version: config.version,
        files: [{ name: config.file, content: code }]
      });
      const lines = res.data.run.output.split("\n");
      setOutput(lines);
      socket.emit("output_change", { roomId, output: lines });
    } catch (e) {
      setOutput(["Error executing code."]);
    } finally { setIsRunning(false); }
  };

  const downloadCode = () => {
    const config = LANGUAGES[language as keyof typeof LANGUAGES];
    const blob = new Blob([code], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = config.file;
    a.click();
  };

  const AudioElement = ({ peer }: { peer: SimplePeer.Instance }) => {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    peer.on("stream", (stream) => {
      if (ref.current) {
        ref.current.srcObject = stream;
        // Force play immediately
        ref.current.play().catch(console.error);
      }
    });

    // LISTENER: If the audio pauses (because of silence), force it to play again
    const handlePause = () => {
        if (ref.current && !ref.current.ended) {
            console.log("Audio paused unexpectedly, resuming...");
            ref.current.play().catch(console.error);
        }
    };

    const audioEl = ref.current;
    audioEl?.addEventListener("pause", handlePause);
    
    return () => {
        audioEl?.removeEventListener("pause", handlePause);
    };
  }, [peer]);

  return (
      <audio 
        playsInline 
        autoPlay 
        ref={ref} 
        controls={false} // Hide controls
      />
  );
};

  if (!joined) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-midnight text-white p-4">
        <div className="bg-surface p-8 rounded-xl shadow-2xl border border-border-dim w-full max-w-md text-center">
          <h1 className="text-3xl font-bold mb-2 tracking-tight">SyncCode</h1>
          <p className="text-gray-400 mb-8 text-sm">Real-time Collaborative IDE</p>
          <div className="flex gap-2 mb-4">
             <input type="text" placeholder="Enter Room ID..." value={roomId}
              className="flex-1 bg-charcoal border border-border-dim text-white p-3 rounded focus:outline-none focus:border-accent"
              onChange={(e) => setRoomId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            />
            <button onClick={generateRoomId} className="bg-charcoal border border-border-dim hover:bg-gray-800 text-gray-300 p-3 rounded">🎲</button>
          </div>
          <button onClick={() => joinRoom()} className="w-full bg-accent hover:bg-blue-600 text-white font-semibold p-3 rounded transition-all">Join Room</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-midnight text-white overflow-hidden">
      {peers.map((p) => <AudioElement key={p.peerID} peer={p.peer} />)}

      <header className="relative z-50 bg-surface border-b border-border-dim flex flex-col md:flex-row md:items-center px-4 py-3 gap-3 md:justify-between shrink-0">
        
        <div className="flex items-center justify-between md:justify-start gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">SyncCode</h1>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-charcoal px-2 py-1 rounded border border-border-dim text-gray-400">ID: {roomId}</span>
              <span className="text-xs bg-charcoal px-2 py-1 rounded border border-border-dim text-gray-400">👥 {userCount}</span>
            </div>
          </div>
          
          <button 
             onClick={leaveRoom}
             className="text-xs font-semibold bg-red-900/20 text-red-400 border border-red-900 px-3 py-1 rounded hover:bg-red-900/40 transition-all md:hidden"
          >
            Leave
          </button>
        </div>
        
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-hide">
           {!voiceActive ? (
            <button onClick={startVoice} className="whitespace-nowrap text-sm font-semibold flex items-center gap-1 bg-green-900/30 text-green-400 px-4 py-2 rounded border border-green-900 hover:bg-green-900/50 transition-all">
                🎙️ Voice
            </button>
          ) : (
             <button onClick={toggleMute} className={`whitespace-nowrap text-sm font-semibold flex items-center gap-1 px-4 py-2 rounded border transition-all ${isMuted ? 'bg-red-900/30 text-red-400 border-red-900' : 'bg-green-900/30 text-green-400 border-green-900 animate-pulse'}`}>
                {isMuted ? '🔇 Muted' : '🗣️ Live'}
            </button>
          )}

          <select value={language} onChange={handleLanguageChange} className="bg-charcoal border border-border-dim text-sm text-gray-300 rounded px-3 py-2 focus:outline-none focus:border-accent">
            <option value="javascript">JS</option>
            <option value="python">Py</option>
            <option value="java">Java</option>
          </select>
          
          <button onClick={downloadCode} className="text-sm font-medium bg-charcoal border border-border-dim text-gray-300 px-4 py-2 rounded hover:bg-gray-800 hover:text-white transition-all flex items-center gap-2">
             Save
          </button>

          <button onClick={runCode} disabled={isRunning} className={`whitespace-nowrap px-6 py-2 rounded text-sm font-semibold transition-all flex items-center gap-2 ${isRunning ? 'bg-gray-600' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'}`}>
            {isRunning ? '...' : '▶ Run'}
          </button>
          
          <button 
             onClick={leaveRoom}
             className="hidden md:block text-xs font-semibold bg-red-900/20 text-red-400 border border-red-900 px-3 py-2 rounded hover:bg-red-900/40 transition-all ml-2"
          >
            Leave
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative z-0">
        <div className="flex-1 md:w-[70%] border-b md:border-b-0 md:border-r border-border-dim relative h-[50dvh] md:h-auto">
           <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            onChange={handleEditorChange}
            options={{ minimap: { enabled: false }, fontSize: 14, padding: { top: 20 }, fontFamily: 'Fira Code, monospace', automaticLayout: true }}
           />
        </div>
        <div className="h-[40dvh] md:h-auto md:w-[30%] bg-[#0f0f0f] flex flex-col">
          <div className="h-10 bg-surface border-b border-border-dim flex items-center px-4 justify-between shrink-0">
            <span className="text-sm text-gray-400 font-mono">Terminal</span>
            <button onClick={() => { setOutput([]); socket.emit("output_change", { roomId, output: [] }); }} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
          </div>
          <div className="flex-1 p-4 font-mono text-sm overflow-auto text-gray-300 pb-20 md:pb-4">
            {output.map((line, i) => <div key={i} className="mb-1 whitespace-pre-wrap">{line || <br/>}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;