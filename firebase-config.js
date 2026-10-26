    const firebaseConfig = {
      apiKey: "AIzaSyAyL8UkHQ7GaBwyqAFVtWeiA3yCqQ5q9Pg",
      authDomain: "tata-arsip-digital.firebaseapp.com",
      projectId: "tata-arsip-digital",
      storageBucket: "tata-arsip-digital.firebasestorage.app",
      messagingSenderId: "633141554177",
      appId: "1:633141554177:web:7dda013d07befd513e6400",
      measurementId: "G-LHXCXM40PE"
    };
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const dbFirestore = firebase.firestore();
    const storage = firebase.storage();
