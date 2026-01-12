import { useEffect, useState, useRef } from "react";
import io, { Socket } from "socket.io-client";
import Editor from "@monaco-editor/react";
import axios from "axios";
import SimplePeer from "simple-peer";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const socket: Socket = io(BACKEND_URL);

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
  
  // Logic Refs
  const isRemoteUpdate = useRef(false);
  const editorRef = useRef<any>(null);

  // Voice State
  const [peers, setPeers] = useState<PeerNode[]>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [voiceActive, setVoiceActive] = useState<boolean>(false);
  const peersRef = useRef<PeerNode[]>([]);

  // --- Persistence ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      setRoomId(roomFromUrl);
      joinRoom(roomFromUrl, false);
    }
  }, []);

  const joinRoom = (id: string = roomId, updateUrl = true) => {
    if (id.trim() !== "") {
      socket.emit("join_room", id);
      setRoomId(id);
      setJoined(true);
      if (updateUrl) {
        window.history.pushState({}, "", `${window.location.pathname}?room=${id}`);
      }
    }
  };

  const leaveRoom = () => {
    socket.emit("leave_room");
    setJoined(false);
    setRoomId("");
    setPeers([]);
    setVoiceActive(false);
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        setAudioStream(null);
    }
    window.history.pushState({}, "", window.location.pathname);
    window.location.reload();
  };

  const generateRoomId = () => setRoomId(crypto.randomUUID().slice(0, 8));

  // --- NEW EDITOR LOGIC (Simultaneous Typing) ---
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    // Listen for changes
    editor.onDidChangeModelContent((event: any) => {
        if (isRemoteUpdate.current) return;

        const currentCode = editor.getValue();
        setCode(currentCode); // Sync React state for Run button

        // Send Delta (Small change) + Full Code (Backup)
        socket.emit("code_change", { 
            roomId, 
            delta: event.changes, 
            code: currentCode 
        });
    });
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    setLanguage(newLang);
    socket.emit("language_change", { roomId, language: newLang });
    const newCode = CODE_TEMPLATES[newLang as keyof typeof CODE_TEMPLATES];
    if (editorRef.current) editorRef.current.setValue(newCode);
    setCode(newCode);
    socket.emit("code_change", { roomId, code: newCode, delta: null });
  };

  // --- SOCKETS ---
  useEffect(() => {
    socket.on("sync_state", (state) => {
      isRemoteUpdate.current = true;
      if (editorRef.current) editorRef.current.setValue(state.code);
      setCode(state.code);
      setLanguage(state.language);
      setOutput(state.output);
      setTimeout(() => { isRemoteUpdate.current = false; }, 100);
    });

    socket.on("receive_code", (payload) => {
      if (!editorRef.current) return;

      if (payload.delta) {
        // Apply only the change (prevents cursor jumping & overwriting)
        isRemoteUpdate.current = true;
        editorRef.current.executeEdits("remote", payload.delta);
        setCode(editorRef.current.getValue());
        isRemoteUpdate.current = false;
      } else {
        // Fallback for full replacements
        isRemoteUpdate.current = true;
        editorRef.current.setValue(payload.code);
        setCode(payload.code);
        setTimeout(() => { isRemoteUpdate.current = false; }, 50);
      }
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
      socket.off("user_left");
    };
  }, [audioStream]);

  // --- Voice & Utils ---
  const startVoice = () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone blocked. Ensure HTTPS/Ngrok."); return;
    }
    navigator.mediaDevices.getUserMedia({ video: false, audio: true })
      .then(stream => { setAudioStream(stream); setVoiceActive(true); socket.emit("request_users", roomId); })
      .catch(err => console.error(err));
  };
  const toggleMute = () => { if (audioStream) { const t = audioStream.getAudioTracks()[0]; t.enabled = !t.enabled; setIsMuted(!t.enabled); }};
  const createPeer = (u:string, c:string, s:MediaStream) => {
    const p = new SimplePeer({ initiator:true, trickle:false, stream:s, config:{iceServers:[{urls:"stun:stun.l.google.com:19302"}]} });
    p.on("signal", sig => socket.emit("sending_signal", { userToSignal:u, callerID:c, signal:sig }));
    return p;
  };
  const addPeer = (sig:any, c:string, s:MediaStream) => {
    const p = new SimplePeer({ initiator:false, trickle:false, stream:s, config:{iceServers:[{urls:"stun:stun.l.google.com:19302"}]} });
    p.on("signal", sig => socket.emit("returning_signal", { signal:sig, callerID:c }));
    p.signal(sig); return p;
  };
  const runCode = async () => {
    setIsRunning(true); setOutput(["Running..."]); socket.emit("output_change", { roomId, output: ["Running..."] });
    try {
      const config = LANGUAGES[language as keyof typeof LANGUAGES];
      const res = await axios.post("https://emkc.org/api/v2/piston/execute", { language, version: config.version, files: [{ name: config.file, content: code }] });
      const lines = res.data.run.output.split("\n"); setOutput(lines); socket.emit("output_change", { roomId, output: lines });
    } catch (e) { setOutput(["Error executing code."]); } finally { setIsRunning(false); }
  };
  const downloadCode = () => {
    const blob = new Blob([code], {type: 'text/plain'}); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = LANGUAGES[language as keyof typeof LANGUAGES].file; a.click();
  };
  const AudioElement = ({ peer }: { peer: SimplePeer.Instance }) => {
    const ref = useRef<HTMLAudioElement>(null);
    useEffect(() => { peer.on("stream", s => { if(ref.current) { ref.current.srcObject = s; ref.current.play().catch(console.error); }}); }, [peer]);
    return <audio playsInline autoPlay ref={ref} controls={false} />;
  };

  // --- RENDER ---
  if (!joined) {
    // RESTORED: Original Landing Page UI
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

  // RESTORED: Original Header UI (User Count, Colors, Layout)
  return (
    <div className="h-[100dvh] flex flex-col bg-midnight text-white overflow-hidden">
      {peers.map((p) => <AudioElement key={p.peerID} peer={p.peer} />)}

      <header className="relative z-50 bg-surface border-b border-border-dim flex flex-col md:flex-row md:items-center px-4 py-3 gap-3 md:justify-between shrink-0">
        
        <div className="flex items-center justify-between md:justify-start gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">SyncCode</h1>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-charcoal px-2 py-1 rounded border border-border-dim text-gray-400">ID: {roomId}</span>
              {/* RESTORED: User Count Badge */}
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
           {/* LOGIC FIX: Uncontrolled Editor with onMount listener */}
           <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            defaultValue={code} // Use defaultValue, not value
            onMount={handleEditorDidMount}
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