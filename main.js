import "./style.css";

import firebase from "firebase/app";
import "firebase/firestore";

import firebaseConfig from "./config.js";

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById("webcamButton");
const webcamVideo = document.getElementById("webcamVideo");
const callButton = document.getElementById("callButton");
const callInput = document.getElementById("callInput");
const answerButton = document.getElementById("answerButton");
const remoteVideo = document.getElementById("remoteVideo");

// On load hide the .videos
document.querySelector(".videoRemote").style.display = "none";
document.querySelector(".videoLocal").style.display = "none";

// Initialize the map
var mymap = L.map("mapid").setView([49.184585, -0.36469], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(mymap);

// Setup media sources

webcamButton.onclick = async () => {
  document.querySelector(".videoLocal").style.display = "block";
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// Create an offer
callButton.onclick = async () => {
  // Request camera access
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  if (!localStream) {
    console.log('Could not access the webcam');
    return;
  }

  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  // Reference Firestore collections for signaling
  const callDoc = firestore.collection("calls").doc();
  const offerCandidates = callDoc.collection("offerCandidates");
  const answerCandidates = callDoc.collection("answerCandidates");

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      // Display the remote camera
      document.querySelector(".videoRemote").style.display = "block";
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection("calls").doc(callId);
  const answerCandidates = callDoc.collection("answerCandidates");
  const offerCandidates = callDoc.collection("offerCandidates");

  // Display the 2 cameras
  document.querySelector(".videoRemote").style.display = "block";
  document.querySelector(".videoLocal").style.display = "block";

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === "added") {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};

// Ask for the user's name when they join the page
let userName;
do {
    userName = prompt("Please enter your name");
} while (!userName);

// Get the user's location
navigator.geolocation.getCurrentPosition(async function (position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;

  // Add a marker to the map at the user's location
  var marker = L.marker([lat, lng]).addTo(mymap);
  marker.bindTooltip(userName, { permanent: true, direction: "right" });

  // Store the user's name and location in Firebase
  await firestore.collection("users").add({
    name: userName,
    location: new firebase.firestore.GeoPoint(lat, lng),
  });
});

// Display all users on the map
firestore.collection("users").onSnapshot((snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === "added") {
      const user = change.doc.data();
      var marker = L.marker([
        user.location.latitude,
        user.location.longitude,
      ]).addTo(mymap);
      marker.bindTooltip(user.name, { permanent: true, direction: "right" });

      // Add the user to the #usersList
      const li = document.createElement("li");
      li.textContent = user.name;
      document.getElementById("usersList").appendChild(li);
    }
  });
});

// Accelerometer
if (window.DeviceMotionEvent) {
  window.addEventListener("devicemotion", function (event) {
    var x = event.accelerationIncludingGravity.x;
    var y = event.accelerationIncludingGravity.y;
    var z = event.accelerationIncludingGravity.z;

    if (x === null && y === null && z === null) {
      document.getElementById("accelerometerData").innerHTML =
        "Accelerometer is not available on this device.";
    } else {
      document.getElementById("accelerometerData").style.display = "block";
      document.getElementById("accelerometerData").innerHTML =
        "Acceleration:<br>" +
        "x: " +
        x +
        "<br>" +
        "y: " +
        y +
        "<br>" +
        "z: " +
        z;
    }
  });
} else {
  document.getElementById("accelerometerData").innerHTML =
    "Accelerometer is not available on this device.";
}