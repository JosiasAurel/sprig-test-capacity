import express from "express";
import * as Y from "yjs";
import admin from "firebase-admin";
import { WebrtcProvider } from "./y-webrtc.js";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { config } from "dotenv";
import { StatsD } from "node-statsd";
import { configDotenv } from "dotenv";
import crypto from "node:crypto";
import { spawn, fork } from "node:child_process";
config();

const app = express();
app.use(express.json());

// function generateRoomIds(roomCount = 10) {
//   return new Array(roomCount).fill(0).map(_ => crypto.randomUUID());
// }
// let rooms = generateRoomIds();

function buildRoomWithClients(roomName = "oDWL6LS54Dt1rpFdftyW", NUM_CLIENTS, updates) {

  const clients = new Array(NUM_CLIENTS).fill(0).map(function (_, idx) {
      return (function (idx, roomName) {
        const controller = new AbortController();
        const { signal } = controller;
        const child_client = fork("./client.js", [idx, roomName], { signal })

        child_client.on("message", message => {
          // update the updates struct
          console.log("got message", message);

          updates[idx] = {
            lastTime: message.now,
            delay: message.now - updates[idx].lastTime,
            count: updates[idx].count + 1,
            pid: child_client.pid,
            roomName: message.roomName,
            roomId: message.id,
            dead: false
          }
          // console.log("received message from child with ID: ", child_client.pid);
        });

        child_client.on("error", (error) => {
          // console.error(`Child ${idx} from Room ${roomName} died \n`, error);

          updates[idx] = { ...updates[idx], dead: true };
          controller.abort(); // terminate the process on error
        });

        process.on("SIGINT", () => {
          // updates[idx] = { ...updates[idx], dead: true };
        });


        return { controller, child_client };
      })(idx, roomName);
  });

  // randomly choose client that will send message
  let randomClient = clients[Math.floor(Math.random() * clients.length)];
  randomClient.child_client.send({ action: "message" });

  return { id: roomName, clients };
}

function main() {
  const NUM_CLIENTS = 10;
  const NUM_ROOMS = 5;
  const roomsWithClientsUpdates = new Array(NUM_ROOMS).fill(
    new Array(NUM_CLIENTS).fill({
      lastTime: 0, // timestamp of last update
      delay: 0, // lastTime - currentTime (aka) delay between the last update and the update just received,
      count: 0, // the number of updates received since the client was started
    })
  );

  const roomsWithClients = new Array(NUM_ROOMS).fill(0).map(() => crypto.randomUUID())
    .map((room, idx) => {
      // build room with clients
      return buildRoomWithClients(room, NUM_CLIENTS, roomsWithClientsUpdates[idx]);
    });

  // process.on("SIGINT", () => {
  //   // terminate all clients in every room
  //   roomsWithClients.forEach(room => {
  //     // console.log(typeof room);
  //     room.clients.forEach(client => client.controller.abort());
  //   });

  //   console.log("ABOUT TO QUIT");
  // });

  setInterval(() => {
    console.clear();
    roomsWithClientsUpdates.forEach((roomClients, idx) => {
      // should divide by the number of active clients if it gets to the point where clients die
      const selectedRoom = roomsWithClients[idx];
      // childProcesses.filter(child => Object.keys(child).includes(selectedRoom.room)).reduce((totalLatency, currentClient) => )
      const averageLatency = roomClients.reduce((totalLatency, currentClient) => totalLatency + currentClient.delay, 0) / roomClients.length;
      // const _roomClients = Object.keys(clientUpdates).filter(clientUpdateKey => clientUpdateKey.includes(selectedRoom.room)).map(clientUpdateKey => clientUpdates[clientUpdateKey]);
      // let roomId = roomsWithClients[idx].id;

      // console.log(selectedRoom);

      console.group(`Room ${idx} / ID: ${selectedRoom.room}`);
      console.log("Average Latency: ", averageLatency);
      console.table(roomClients);
      console.groupEnd();

      // console.log(`
      //   Room ${idx} / ${'ROOMID'}: \n 
      //   average latency: ${averageLatency} \n
      //   clients => `, roomClients);

    });
  }, 1000);

}

main();


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("Listening on port", PORT));