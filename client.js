import { WebrtcProvider } from "./y-webrtc.js";
import * as Y from "yjs";
import express from "express";
import crypto from "node:crypto";

const app = express();
app.use(express.json());

const SIGNALING_SERVERS = ["wss://yjs-signaling-server-5fb6d64b3314.herokuapp.com/"]

const buildLogger = id => thing => console.log(id, thing);

// @param updates {Array<number>} - used to indicate the number of updates each client has received since the start of the program
function createClient(id = 0, roomName) {
    const log = buildLogger(id);

    const ydoc = new Y.Doc();
    let provider = new WebrtcProvider(roomName, ydoc, { signaling: SIGNALING_SERVERS });
    // set the user using awareness  
    provider.awareness.setLocalStateField("user", {
        name: crypto.randomUUID()
    });

    ydoc.on("update", update => {
        const updateText = ydoc.getText("codemirror");
        Y.applyUpdate(ydoc, update);

        process.send({ id })
        // console.log("got update")
    });

    // send updates at random indices every 2.5 seconds
    setInterval(() => {
        ydoc.getText("codemirror").insert(Math.floor(Math.random(), 10), "this change came from the headless client");
    }, 2500);
}

createClient(process.argv[2], "oDWL6LS54Dt1rpFdftyW");

// while (true) {}
app.listen(Math.floor(Math.random() * 5000), () => console.log("Client listening somewhere"))