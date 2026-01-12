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
  
  // Ref to ignore updates that come from the socket
  const isRemoteUpdate = useRef(false);
  const editorRef = useRef<any>(null);

  // Voice State
  const [peers, setPeers] = useState<PeerNode[]>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [voiceActive, setVoiceActive] = useState<boolean>(false);
  const peersRef = useRef<PeerNode[]>([]);

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

  // --- EDITOR MOUNT & CHANGE LOGIC (CRITICAL FIX) ---
  
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    // Listen for granular changes (deltas) instead of full text
    editor.onDidChangeModelContent((event: any) => {
        // If this change came from the socket, IGNORE IT (don't send it back)
        if (isRemoteUpdate.current) { 
            return; 
        }

        const currentCode = editor.getValue();
        setCode(currentCode); // Update React state for Run/Save buttons

        // Send the specific change (delta) AND the full code (for backup)
        socket.emit("code_change", { 
            roomId, 
            delta: event.changes, // This allows simultaneous typing!
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

  // --- SOCKET LISTENERS ---
  useEffect(() => {
    socket.on("sync_state", (state) => {
      isRemoteUpdate.current = true;
      if (editorRef.current) editorRef.current.setValue(state.code);
      setCode(state.code);
      setLanguage(state.language);
      setOutput(state.output);
      setTimeout(() => { isRemoteUpdate.current = false; }, 100);
    });

    // UPDATED: Handle Delta Updates
    socket.on("receive_code", (payload) => {
      if (!editorRef.current) return;

      // 1. If we have a delta (smart update), use it
      if (payload.delta) {
        isRemoteUpdate.current = true;
        
        // This applies the change EXACTLY where it happened
        // without overwriting the rest of the file
        editorRef.current.executeEdits("remote", payload.delta);
        
        // Sync the React state just in case
        setCode(editorRef.current.getValue());
        
        // Reset flag immediately
        isRemoteUpdate.current = false;
      } 
      // 2. Fallback: If no delta (e.g., initial load), replace whole text
      else {
        isRemoteUpdate.current = true;
        editorRef.current.setValue(payload.code);
        setCode(payload.code);
        setTimeout(() => { isRemoteUpdate.current = false; }, 50);
      }
    });

    socket.on("receive_language", (lang) => setLanguage(lang));
    socket.on("receive_output", (out) => setOutput(out));
    socket.on("user_count", (cnt) => setUserCount(cnt));

    // ... (Voice logic remains same) ...
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

  // ... (Run, Download, Voice functions remain same) ...
  const startVoice = () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone blocked."); return;
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

  if (!joined) return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-midnight text-white p-4">
        <div className="bg-surface p-8 rounded-xl shadow-2xl border border-border-dim w-full max-w-md text-center">
          <h1 className="text-3xl font-bold mb-2">SyncCode</h1>
          <input type="text" placeholder="Enter Room ID..." value={roomId} className="w-full bg-charcoal border border-border-dim text-white p-3 rounded mb-4" onChange={e=>setRoomId(e.target.value)} />
          <div className="flex gap-2"><button onClick={generateRoomId} className="p-3 bg-charcoal rounded">🎲</button><button onClick={()=>joinRoom()} className="flex-1 bg-accent p-3 rounded">Join</button></div>
        </div>
      </div>
  );

  return (
    <div className="h-[100dvh] flex flex-col bg-midnight text-white overflow-hidden">
      {peers.map((p) => <AudioElement key={p.peerID} peer={p.peer} />)}
      <header className="bg-surface border-b border-border-dim flex items-center px-4 py-3 justify-between">
        <div className="flex items-center gap-4"><h1 className="text-xl font-bold">SyncCode</h1><span className="text-xs bg-charcoal px-2 py-1 rounded">ID: {roomId}</span></div>
        <div className="flex gap-2">
            {!voiceActive ? <button onClick={startVoice} className="bg-green-900/30 text-green-400 px-4 py-2 rounded">🎙️ Voice</button> : <button onClick={toggleMute} className="bg-red-900/30 text-red-400 px-4 py-2 rounded">{isMuted ? '🔇' : '🗣️'}</button>}
            <select value={language} onChange={handleLanguageChange} className="bg-charcoal border border-border-dim rounded px-3 py-2"><option value="javascript">JS</option><option value="python">Py</option><option value="java">Java</option></select>
            <button onClick={downloadCode} className="bg-charcoal px-4 py-2 rounded">Save</button>
            <button onClick={runCode} disabled={isRunning} className="bg-emerald-600 px-6 py-2 rounded">{isRunning?'...':'Run'}</button>
            <button onClick={leaveRoom} className="text-red-400 text-xs border border-red-900 px-3 py-2 rounded ml-2">Leave</button>
        </div>
      </header>
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 md:w-[70%] border-r border-border-dim relative">
           <Editor 
                height="100%" 
                language={language} 
                theme="vs-dark" 
                defaultValue={code} // IMPORTANT: Uncontrolled
                onMount={handleEditorDidMount} // Logic moved here
                options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true }} 
           />
        </div>
        <div className="md:w-[30%] bg-[#0f0f0f] flex flex-col p-4 font-mono text-sm overflow-auto text-gray-300">
            <div className="flex justify-between mb-2"><span className="text-gray-500">Terminal</span><button onClick={()=>setOutput([])} className="text-xs">Clear</button></div>
            {output.map((l,i)=><div key={i}>{l||<br/>}</div>)}
        </div>
      </div>
    </div>
  );
}
export default App;