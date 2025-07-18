'use strict';

let isInitiator = false;
let isChannelReady = false;
let isStarted = false;
let localStream;
let pc;
let remoteStream;
let turnReady;
let dataChannel;
let pcConfig = {
  'iceServers': [{
    'urls': 'stun:stun.l.google.com:19302'
  }]
};

let sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

let startRecordBtn = document.getElementById('start-record-btn');
let stopRecordBtn = document.getElementById('stop-record-btn');
let recognition = null;
let noteContent = '';
let isRecognitionPaused = false;
let translationTimeout;
let synth = window.speechSynthesis;
let isRecognitionActive = false;

const GOOGLE_API_KEY='AIzaSyCAN5iy-4lCVQMiUu4d7Dwu9JOYp_Ex2bA';

$(document).ready(function() {
  console.log('Input language element exists:', $('#input_language').length);
  console.log('Output language element exists:', $('#output_language').length);
  console.log('Voice number element exists:', $('#voice_number').length);
  console.log('Input language val:', $('#input_language').val());
  console.log('Output language val:', $('#output_language').val());
  let urlParams = new URLSearchParams(window.location.search)
  let room = urlParams.get('room') || ''
  let username = localStorage.getItem('username') || ''
  if (!username) {
    username = prompt('Enter your name:')
    localStorage.setItem('username', username)
  }
  if (!room) {
    room = Math.random().toString(36).substring(2, 10)
    window.history.replaceState({}, '', `?room=${room}`)
    $('#recording-instructions').prepend(`<div style='margin-bottom:1em'>Share this link to invite: <input style='width:70%' value='${window.location.href}' readonly onclick='this.select()'></div>`)
  }
  let socket = io({
    transports: ['websocket'],
    upgrade: false,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  })
  socket.emit('create or join', room)
  socket.on('created', function(room) {
    isInitiator = true
  })
  socket.on('full', function(room) {
    showError('Room is full. Please create a new meeting.')
  })
  socket.on('join', function(room) {
    isChannelReady = true
  })
  socket.on('joined', function(room) {
    isChannelReady = true
  })
  socket.on('log', function(array) {
    console.log.apply(console, array)
  })
  function sendMessage(message) {
    console.log('Client sending message: ', message);
    socket.emit('message', message);
  }
  socket.on('message', function(message) {
    console.log('Client received message:', message);
    if (message === 'got user media') {
      maybeStart();
    } else if (message.type === 'offer') {
      if (!isInitiator && !isStarted) {
        maybeStart();
      }
      pc.setRemoteDescription(new RTCSessionDescription(message));
      doAnswer();
    } else if (message.type === 'answer' && isStarted) {
      pc.setRemoteDescription(new RTCSessionDescription(message));
    } else if (message.type === 'candidate' && isStarted) {
      const candidate = new RTCIceCandidate({
        sdpMLineIndex: message.label,
        candidate: message.candidate
      });
      pc.addIceCandidate(candidate);
    } else if (message === 'bye' && isStarted) {
      handleRemoteHangup();
    }
  });
  function handleRemoteHangup() {
    console.log('speechbye');
    stop();
    isInitiator = false;
  }
  function stop() {
    isStarted = false;
    if (pc) {
      pc.close();
      pc = null;
    }
  }
  navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
  })
  .then(gotStream)
  .catch(function(e) {
    alert('getUserMedia() error: ' + e.name);
  });
  function gotStream(stream) {
    console.log('Adding local stream.');
    localStream = stream;
    const localVideo = document.querySelector('#localVideo');
    localVideo.srcObject = stream;
    sendMessage('got user media');
    if (isInitiator) {
      maybeStart();
    }
  }
  function maybeStart() {
    console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
    if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
      console.log('>>>>>> creating peer connection');
      createPeerConnection();
      pc.addStream(localStream);
      isStarted = true;
      console.log('isInitiator', isInitiator);
      if (isInitiator) {
        doCall();
      }
    }
  }
  function createPeerConnection() {
    try {
      pc = new RTCPeerConnection(pcConfig);
      pc.onicecandidate = handleIceCandidate;
      pc.onaddstream = handleRemoteStreamAdded;
      pc.onremovestream = handleRemoteStreamRemoved;
      if (isInitiator) {
        dataChannel = pc.createDataChannel('translations');
        setupDataChannel(dataChannel);
      } else {
        pc.ondatachannel = function(event) {
          dataChannel = event.channel;
          setupDataChannel(dataChannel);
        };
      }
      console.log('Created RTCPeerConnnection');
    } catch (e) {
      console.log('Failed to create PeerConnection, exception: ' + e.message);
      alert('Cannot create RTCPeerConnection object.');
      return;
    }
  }
  function setupDataChannel(channel) {
    channel.onmessage = function(event) {
      const data = JSON.parse(event.data);
      if (data.type === 'translation') {
        $('#remoteText').html(`<strong>${data.originalText}</strong><br>${data.translatedText}`);
        speakTranslation(data.translatedText, data.targetLanguage);
      }
    };
    channel.onopen = function() {
      console.log('Data channel is open');
    };
    channel.onclose = function() {
      console.log('Data channel is closed');
    };
  }
  function handleIceCandidate(event) {
    console.log('icecandidate event: ', event);
    if (event.candidate) {
      sendMessage({
        type: 'candidate',
        label: event.candidate.sdpMLineIndex,
        id: event.candidate.sdpMid,
        candidate: event.candidate.candidate
      });
    } else {
      console.log('End of candidates.');
    }
  }
  function doCall() {
    console.log('Sending offer to peer');
    pc.createOffer().then(
      setLocalAndSendMessage,
      onCreateSessionDescriptionError
    );
  }
  function doAnswer() {
    console.log('Sending answer to peer.');
    pc.createAnswer().then(
      setLocalAndSendMessage,
      onCreateSessionDescriptionError
    );
  }
  function setLocalAndSendMessage(sessionDescription) {
    pc.setLocalDescription(sessionDescription);
    console.log('setLocalAndSendMessage sending message', sessionDescription);
    sendMessage(sessionDescription);
  }
  function onCreateSessionDescriptionError(error) {
    console.log('Failed to create session description: ' + error.toString());
  }
  function handleRemoteStreamAdded(event) {
    console.log('Remote stream added.');
    remoteStream = event.stream;
    const remoteVideo = document.querySelector('#remoteVideo');
    remoteVideo.srcObject = remoteStream;
  }
  function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
  }
  function initializeSpeechRecognition() {
    if ('webkitSpeechRecognition' in window) {
      recognition = new webkitSpeechRecognition();
    } else if ('SpeechRecognition' in window) {
      recognition = new SpeechRecognition();
    } else {
      $('#start-record-btn').prop('disabled', true);
      $('#pause-record-btn').prop('disabled', true);
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = function() {
      console.log('Recognition started');
      isRecognitionActive = true;
      $('#start-record-btn').prop('disabled', true);
      $('#pause-record-btn').prop('disabled', false);
    };
    recognition.onend = function() {
      console.log('Recognition ended');
      isRecognitionActive = false;
      if (!isRecognitionPaused) {
        setTimeout(() => {
          startRecognition();
        }, 100);
      } else {
        $('#start-record-btn').prop('disabled', false);
        $('#pause-record-btn').prop('disabled', true);
      }
    };
    recognition.onresult = function(event) {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript.length > 0) {
        noteContent += finalTranscript + ' ';
        $('#note-textarea').val(noteContent);
        clearTimeout(translationTimeout);
        translationTimeout = setTimeout(function() {
          translateText(finalTranscript);
        }, 1500);
      }
      $('#interim-note').html(interimTranscript);
    };
    recognition.onerror = function(event) {
      console.error('Recognition error:', event.error);
    };
  }
  function startRecognition() {
    try {
      if (!recognition) {
        initializeSpeechRecognition();
      }
      let inputLanguageValue = $('#input_language').val();
      console.log("Starting recognition with language:", inputLanguageValue);
      const langMap = {
        'en': 'en-US',
        'hi': 'hi-IN',
        'kn': 'kn-IN'
      };
      recognition.lang = langMap[inputLanguageValue] || inputLanguageValue;
      isRecognitionPaused = false;
      recognition.start();
    } catch (err) {
      console.error("Error starting recognition:", err);
      if (err.name === 'InvalidStateError') {
        recognition.stop();
        setTimeout(() => {
          startRecognition();
        }, 100);
      }
    }
  }
  function pauseRecognition() {
    console.log("Pausing recognition");
    isRecognitionPaused = true;
    if (recognition) {
      recognition.stop();
    }
  }
  $(document).ready(function() {
    initializeSpeechRecognition();
    $('#start-record-btn').on('click', function() {
      console.log("Start button clicked");
      if (noteContent.length) {
        noteContent += ' ';
      }
      startRecognition();
    });
    $('#pause-record-btn').on('click', function() {
      console.log("Pause button clicked");
      pauseRecognition();
    });
  });
  function translateText(text) {
    if (!text || text.trim().length === 0) return;
    const inputLang = $('#input_language').val();
    const outputLang = $('#output_language').val();
    if (inputLang === outputLang) {
      const message = {
        type: 'translation',
        originalText: text,
        translatedText: text,
        targetLanguage: outputLang
      };
      $('#localText').html(`<strong>${text}</strong><br>${text}`);
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(message));
      }
      return;
    }
    console.log(`Translating from ${inputLang} to ${outputLang}: "${text}"`);
    const url = `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_API_KEY}`;
    const data = {
      q: text,
      source: inputLang,
      target: outputLang,
      format: 'text'
    };
    $('#translated-output').html('<i>Translating...</i>');
    $.ajax({
      url: url,
      type: 'POST',
      data: data,
      dataType: 'json',
      success: function(response) {
        if (response && response.data && response.data.translations && response.data.translations.length > 0) {
          const translation = response.data.translations[0].translatedText;
          $('#translated-output').html(translation);
          $('#localText').html(`<strong>${text}</strong><br>${translation}`);
          const message = {
            type: 'translation',
            originalText: text,
            translatedText: translation,
            targetLanguage: outputLang
          };
          if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify(message));
          }
        } else {
          console.error('Translation response format error:', response);
          $('#translated-output').html('<i>Translation failed: Invalid response format</i>');
        }
      },
      error: function(xhr, status, error) {
        console.error('Translation error details:', {
          status: xhr.status,
          statusText: xhr.statusText,
          responseText: xhr.responseText,
          error: error
        });
        let errorMessage = 'Translation failed';
        if (xhr.status === 403) {
          errorMessage = 'API key error: Please check if the API key is valid and has proper permissions';
        } else if (xhr.status === 429) {
          errorMessage = 'API quota exceeded: Please try again later';
        } else if (xhr.responseText) {
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            if (errorResponse.error && errorResponse.error.message) {
              errorMessage = `Translation error: ${errorResponse.error.message}`;
            }
          } catch (e) {
            errorMessage = `Translation error: ${error}`;
          }
        }
        $('#translated-output').html(`<i>${errorMessage}</i>`);
      }
    });
  }
  function populateVoiceList() {
    if (synth) {
      const voices = synth.getVoices();
      const voiceSelect = $('#voice_number');
      voiceSelect.empty();
      voiceSelect.append(`<option value="-1">Default</option>`);
      voices.forEach((voice, index) => {
        const langCode = voice.lang.toLowerCase();
        if (langCode.startsWith('en') || langCode.startsWith('hi') || langCode.startsWith('kn')) {
          voiceSelect.append(`<option value="${index}">${voice.name} (${voice.lang})</option>`);
        }
      });
    }
  }
  function initializeVoices() {
    if (synth) {
      let voices = synth.getVoices();
      if (voices.length > 0) {
        console.log('Voices loaded:', voices.length);
        populateVoiceList();
      }
      synth.onvoiceschanged = function() {
        voices = synth.getVoices();
        console.log('Voices changed, now available:', voices.length);
        populateVoiceList();
      };
      setTimeout(() => {
        voices = synth.getVoices();
        if (voices.length > 0) {
          console.log('Voices loaded after timeout:', voices.length);
          populateVoiceList();
        }
      }, 2000);
    }
  }
  function speakTranslation(text, lang) {
    if (!synth) {
      console.error('Speech synthesis not available');
      return;
    }
    synth.cancel();
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      let voices = synth.getVoices();
      if (voices.length === 0) {
        console.log('No voices available, waiting for voices to load...');
        let voiceLoadAttempts = 0;
        const maxAttempts = 3;
        const trySpeak = () => {
          voices = synth.getVoices();
          if (voices.length > 0) {
            setupVoiceAndSpeak();
          } else if (voiceLoadAttempts < maxAttempts) {
            voiceLoadAttempts++;
            setTimeout(trySpeak, 500);
          } else {
            console.error('Failed to load voices after multiple attempts');
            utterance.voice = null;
            utterance.lang = lang;
            synth.speak(utterance);
          }
        };
        trySpeak();
      } else {
        setupVoiceAndSpeak();
      }
      function setupVoiceAndSpeak() {
        const selectedVoiceNum = parseInt($('#voice_number').val());
        const langMap = {
          'en': ['en-IN', 'en-US', 'en-GB'],
          'hi': ['hi-IN'],
          'kn': ['kn-IN']
        };
        let voice = null;
        if (selectedVoiceNum >= 0 && selectedVoiceNum < voices.length) {
          voice = voices[selectedVoiceNum];
        } else {
          const preferredLangs = langMap[lang] || [lang];
          for (const preferredLang of preferredLangs) {
            voice = voices.find(v => v.lang.toLowerCase() === preferredLang.toLowerCase());
            if (voice) break;
          }
          if (!voice) {
            voice = voices.find(v => preferredLangs.some(pl => 
              v.lang.toLowerCase().startsWith(pl.split('-')[0].toLowerCase())
            ));
          }
          if (!voice && (lang === 'hi' || lang === 'kn')) {
            voice = voices.find(v => v.lang.includes('IN'));
          }
          if (!voice) {
            voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
          }
        }
        if (voice) {
          console.log('Selected voice:', voice.name, 'for language:', lang);
          utterance.voice = voice;
        } else {
          console.log('No suitable voice found, using default');
          utterance.voice = null;
        }
        utterance.lang = voice ? voice.lang : lang;
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onstart = () => console.log('Speech started');
        utterance.onend = () => console.log('Speech ended');
        utterance.onerror = (event) => {
          console.error('Speech error:', event);
          if (utterance.voice) {
            console.log('Retrying with default voice...');
            utterance.voice = null;
            synth.speak(utterance);
          }
        };
        try {
          synth.speak(utterance);
        } catch (err) {
          console.error('Speech synthesis error:', err);
          utterance.voice = null;
          synth.speak(utterance);
        }
      }
    }, 100);
  }
  initializeVoices();
  $('#reset-btn').on('click', function() {
    noteContent = '';
    $('#note-textarea').val('');
    $('#translated-output').html('');
    $('#interim-note').html('');
    if (synth) {
      synth.cancel();
    }
  });
});