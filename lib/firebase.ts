import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBiuc6oZR_A4fCJY_yCg-WqShya7afM3Aw",
  authDomain: "clouded-c25e1.firebaseapp.com",
  projectId: "clouded-c25e1",
  storageBucket: "clouded-c25e1.firebasestorage.app",
  messagingSenderId: "895906810214",
  appId: "1:895906810214:web:745d005a4aff4c5604e0a7",
  measurementId: "G-1J4RVHN7ZV"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
