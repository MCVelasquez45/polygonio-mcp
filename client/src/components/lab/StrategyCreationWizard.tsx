import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { extractStrategy, startAgentExtraction, transcribeAudioUpload } from '../../api/agent';

type StrategyType = 'momentum' | 'mean_reversion' | 'volatility' | '0dte' | 'spreads' | 'futures' | 'custom';

type WizardStep = 'method' | 'transcript' | 'type' | 'details' | 'parameters' | 'review';

type CreationMethod = 'ai' | 'manual' | null;
type RecordingMode = 'speech' | 'local';

type StrategyTemplate = {
  id: StrategyType;
  name: string;
  description: string;
  icon: string;
  suggestedParameters: Record<string, any>;
};

const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 'momentum',
    name: 'Momentum',
    description: 'Trend-following strategies that capitalize on market momentum',
    icon: '📈',
    suggestedParameters: {
      lookback_period: 20,
      entry_threshold: 0.02,
      position_size: 0.05,
      stop_loss: 0.03,
    },
  },
  {
    id: 'mean_reversion',
    name: 'Mean Reversion',
    description: 'Counter-trend strategies that bet on price reverting to mean',
    icon: '📊',
    suggestedParameters: {
      lookback_period: 14,
      z_score_threshold: 2.0,
      position_size: 0.03,
      take_profit: 0.02,
    },
  },
  {
    id: 'volatility',
    name: 'Volatility',
    description: 'Strategies based on volatility patterns and term structure',
    icon: '🌊',
    suggestedParameters: {
      contango_threshold: 0.05,
      lookback_period: 20,
      position_size: 0.02,
      vix_ceiling: 35,
    },
  },
  {
    id: '0dte',
    name: '0-DTE Scalping',
    description: 'Same-day expiration options trading strategies',
    icon: '⏱',
    suggestedParameters: {
      entry_time_start: '9:35',
      entry_time_end: '11:00',
      delta_target: 0.3,
      stop_loss_pct: 50,
    },
  },
  {
    id: 'spreads',
    name: 'Options Spreads',
    description: 'Multi-leg options strategies like verticals, iron condors',
    icon: '🎯',
    suggestedParameters: {
      min_credit: 0.30,
      max_width: 5,
      days_to_expiry: 30,
      delta_short: 0.15,
    },
  },
  {
    id: 'futures',
    name: 'Futures',
    description: 'Futures contract trading strategies with roll management and margin tracking',
    icon: '📜',
    suggestedParameters: {
      contract: 'ES',
      lookback_period: 14,
      entry_threshold: 0.5,
      position_size_contracts: 2,
      stop_loss_ticks: 8,
      take_profit_ticks: 16,
      roll_days_before_expiry: 5,
    },
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Start from scratch with a blank strategy template',
    icon: '🔧',
    suggestedParameters: {},
  },
];

type Props = {
  onComplete?: (strategy: any) => void;
  onCancel?: () => void;
  initialData?: any;
  socketId?: string | null;
  isProcessing?: boolean;
  onExtractionStart?: () => void;
};

export function StrategyCreationWizard({ onComplete, onCancel, initialData, socketId, isProcessing, onExtractionStart }: Props) {
  const [step, setStep] = useState<WizardStep>(initialData ? 'details' : 'method');
  const [creationMethod, setCreationMethod] = useState<CreationMethod>(initialData ? 'ai' : null);
  const [selectedType, setSelectedType] = useState<StrategyType | null>(initialData ? 'custom' : null);
  const [strategyDetails, setStrategyDetails] = useState({
    name: initialData?.name || '',
    description: initialData?.description || '',
    hypothesis: initialData?.hypothesis || '',
  });
  const [parameters, setParameters] = useState<Record<string, any>>(initialData?.parameters || {});
  const [agentSuggestion, setAgentSuggestion] = useState<string | null>(initialData ? "✨ AI Extraction complete! Review the details below." : null);
  const [transcript, setTranscript] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionStarted, setExtractionStarted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('speech');
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);
  const [audioUploadError, setAudioUploadError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioUploadRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const localRecordingChunksRef = useRef<BlobPart[]>([]);
  const userStoppedRef = useRef(false);
  const speechSupportedRef = useRef(false);

  const selectedTemplate = STRATEGY_TEMPLATES.find(t => t.id === selectedType);

  const applyExtractedData = (data: any) => {
    if (!data || typeof data !== 'object') return;

    const extractedName = typeof data.name === 'string' ? data.name : '';
    const extractedDescription = typeof data.description === 'string' ? data.description : '';
    const extractedHypothesis = typeof data.hypothesis === 'string' ? data.hypothesis : '';
    const extractedParameters =
      data.parameters && typeof data.parameters === 'object' && !Array.isArray(data.parameters) ? data.parameters : {};

    setCreationMethod('ai');
    setSelectedType((data.type as StrategyType) || 'custom');
    setStrategyDetails({
      name: extractedName,
      description: extractedDescription,
      hypothesis: extractedHypothesis,
    });
    setParameters(extractedParameters);
    setStep('details');
    setAgentSuggestion('✨ AI extraction complete. Review and refine before creating the strategy.');
    setExtractionStarted(false);
  };

  useEffect(() => {
    if (!initialData) return;
    applyExtractedData(initialData);
  }, [initialData]);

  const handleTypeSelect = (type: StrategyType) => {
    setSelectedType(type);
    const template = STRATEGY_TEMPLATES.find(t => t.id === type);
    if (template) {
      setParameters(template.suggestedParameters);
      setTimeout(() => {
        setAgentSuggestion(getAgentSuggestion(type));
      }, 500);
    }
  };

  const getAgentSuggestion = (type: StrategyType): string => {
    const suggestions: Record<StrategyType, string> = {
      momentum: 'Based on current market conditions (VIX: 22), momentum strategies are showing strong performance. Consider using 5-min bars for entry timing.',
      mean_reversion: 'SPY has been in a tight range this week. Mean reversion strategies may find opportunities during high-volatility events.',
      volatility: 'VIX term structure shows contango of 6.2%. Short volatility strategies historically perform well in this regime.',
      '0dte': 'Current 0-DTE implied volatility is elevated. Consider targeting 30-delta options for better risk/reward.',
      spreads: 'With earnings season approaching, consider widening your spreads or reducing position sizes.',
      futures: 'ES and NQ futures are showing strong trends. Consider using volume-based roll strategy and ensure margin requirements are factored into position sizing.',
      custom: 'I can help you build your custom strategy. What market conditions are you targeting?',
    };
    return suggestions[type];
  };

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speechSupportedRef.current = false;
      return;
    }

    speechSupportedRef.current = true;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        setTranscript(prev => {
          const trimmed = prev.trim();
          const lastChar = trimmed.slice(-1);
          const needsSpace = trimmed.length > 0 && !['.', '!', '?'].includes(lastChar);
          return trimmed + (needsSpace ? '. ' : ' ') + finalTranscript;
        });
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setRecordingError('Microphone access denied. Please allow microphone permissions in your browser settings.');
        userStoppedRef.current = true;
        setIsRecording(false);
      } else if (event.error === 'no-speech') {
        // No speech detected - don't stop, just let it continue
      } else if (event.error === 'network') {
        setRecordingMode('local');
        setRecordingError('Browser speech service network error. Switched to local recording mode. Click the mic again to record and transcribe through the app.');
        userStoppedRef.current = true;
        try { recognition.stop(); } catch { /* ignore */ }
        setIsRecording(false);
      } else if (event.error === 'aborted') {
        // Ignore - this fires when we call .stop()
      } else {
        setRecordingError(`Speech recognition error: ${event.error}. Try again or type your strategy instead.`);
        userStoppedRef.current = true;
        setIsRecording(false);
      }
    };

    recognition.onend = () => {
      // Browser auto-stops recognition even with continuous=true (e.g., after silence).
      // If the user didn't explicitly stop, restart it automatically.
      if (!userStoppedRef.current) {
        try {
          recognition.start();
        } catch {
          // If restart fails, give up gracefully
          setIsRecording(false);
        }
      } else {
        setIsRecording(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      userStoppedRef.current = true;
      try { recognition.stop(); } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  const stopLocalStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const finalizeLocalRecording = async () => {
    const chunks = localRecordingChunksRef.current;
    localRecordingChunksRef.current = [];
    if (!chunks.length) {
      setRecordingError('No audio captured. Please try again.');
      return;
    }

    setIsTranscribingAudio(true);
    try {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const file = new File([blob], `strategy-recording-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
      const { transcript: transcribedText } = await transcribeAudioUpload(file);
      if (!transcribedText?.trim()) {
        throw new Error('No transcript returned from audio transcription.');
      }
      setTranscript(prev => (prev.trim() ? `${prev.trim()}\n${transcribedText.trim()}` : transcribedText.trim()));
      setAgentSuggestion('🎧 Local recording transcribed. Review/edit the text, then run extraction.');
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        'Audio transcription failed.';
      setRecordingError(String(detail));
    } finally {
      setIsTranscribingAudio(false);
      stopLocalStream();
      mediaRecorderRef.current = null;
    }
  };

  const startLocalRecording = async () => {
    setRecordingError(null);
    setAudioUploadError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      localRecordingChunksRef.current = [];

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          localRecordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setRecordingError('Recording failed. Please try again.');
        setIsRecording(false);
        stopLocalStream();
        mediaRecorderRef.current = null;
      };

      recorder.onstop = () => {
        setIsRecording(false);
        void finalizeLocalRecording();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingMode('local');
      setIsRecording(true);
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setRecordingError('Microphone access denied. Please allow microphone access and try again.');
      } else if (err?.name === 'NotFoundError') {
        setRecordingError('No microphone found. Please connect a microphone and try again.');
      } else {
        setRecordingError('Could not start local audio recording. Please check your microphone settings.');
      }
    }
  };

  const toggleRecording = async () => {
    setRecordingError(null);
    setAudioUploadError(null);

    if (isRecording) {
      if (recordingMode === 'local') {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        } else {
          setIsRecording(false);
          stopLocalStream();
        }
      } else {
        userStoppedRef.current = true;
        try { recognitionRef.current?.stop(); } catch { /* ignore */ }
        setIsRecording(false);
      }
      return;
    }

    if (recordingMode === 'local' || !speechSupportedRef.current) {
      if (!speechSupportedRef.current) {
        setRecordingError('Live browser speech recognition is unavailable. Using local recording + server transcription.');
      }
      await startLocalRecording();
      return;
    }

    // Request microphone permission first
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release the stream immediately - we just needed to trigger the permission prompt
      stream.getTracks().forEach(track => track.stop());
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setRecordingError('Microphone access denied. Please allow microphone access and try again.');
      } else if (err.name === 'NotFoundError') {
        setRecordingError('No microphone found. Please connect a microphone and try again.');
      } else {
        setRecordingError('Could not access microphone. Please check your audio settings.');
      }
      return;
    }

    // Start speech recognition
    try {
      userStoppedRef.current = false;
      recognitionRef.current?.start();
      setRecordingMode('speech');
      setIsRecording(true);
    } catch (error: any) {
      if (error?.message?.includes('already started')) {
        // Already running - just update the state
        setIsRecording(true);
      } else {
        console.error('Failed to start recording:', error);
        setRecordingError('Failed to start speech recognition. Please try again or type your strategy directly.');
      }
    }
  };

  const handleExtractFromTranscript = async () => {
    if (!transcript.trim()) return;

    setAudioUploadError(null);
    setIsExtracting(true);

    try {
      const extracted = await extractStrategy({
        transcript: transcript.trim(),
        socket_id: socketId
      });
      applyExtractedData(extracted);
      setIsExtracting(false);
    } catch (error) {
      console.error('Error running synchronous extraction:', error);
      if (socketId) {
        try {
          onExtractionStart?.();
          await startAgentExtraction({
            transcript: transcript.trim(),
            socket_id: socketId
          });
          setExtractionStarted(true);
          setAgentSuggestion("⚡ I started background extraction. You can close this wizard and review when the result is ready.");
        } catch (backgroundError) {
          console.error('Error starting extraction:', backgroundError);
          setAgentSuggestion("❌ Sorry, I had trouble starting the extraction. Please try again.");
        } finally {
          setIsExtracting(false);
        }
      } else {
        setAgentSuggestion("❌ Sorry, I had trouble extracting from that transcript. Please try again.");
        setIsExtracting(false);
      }
    }
  };

  const handleAudioFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAudioUploadError(null);
    setIsTranscribingAudio(true);

    try {
      const { transcript: transcribedText } = await transcribeAudioUpload(file);
      if (!transcribedText?.trim()) {
        throw new Error('No transcript returned from audio transcription.');
      }

      setTranscript(prev => (prev.trim() ? `${prev.trim()}\n${transcribedText.trim()}` : transcribedText.trim()));
      setAgentSuggestion('🎧 Audio transcription complete. Review/edit the text, then run extraction.');
    } catch (error: any) {
      console.error('Audio transcription failed:', error);
      const detail =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        'Audio transcription failed.';
      setAudioUploadError(String(detail));
    } finally {
      if (audioUploadRef.current) {
        audioUploadRef.current.value = '';
      }
      setIsTranscribingAudio(false);
    }
  };

  const openAudioPicker = () => {
    setAudioUploadError(null);
    audioUploadRef.current?.click();
  };

  const handleNext = () => {
    if (step === 'method') {
      if (creationMethod === 'ai') setStep('transcript');
      else setStep('type');
      return;
    }

    const steps_ai: WizardStep[] = ['method', 'transcript', 'details', 'parameters', 'review'];
    const steps_manual: WizardStep[] = ['method', 'type', 'details', 'parameters', 'review'];
    const steps = creationMethod === 'ai' ? steps_ai : steps_manual;

    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const steps_ai: WizardStep[] = ['method', 'transcript', 'details', 'parameters', 'review'];
    const steps_manual: WizardStep[] = ['method', 'type', 'details', 'parameters', 'review'];
    const steps = creationMethod === 'ai' ? steps_ai : steps_manual;

    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const handleComplete = () => {
    const strategy = {
      type: selectedType,
      ...strategyDetails,
      parameters,
      transcript: transcript.trim() || undefined,
      status: 'draft',
      version: 'v1.0',
      createdAt: new Date().toISOString(),
    };
    onComplete?.(strategy);
  };

  const renderStepIndicator = () => {
    const steps_ai = [
      { id: 'method', label: 'Start' },
      { id: 'transcript', label: 'AI Input' },
      { id: 'details', label: 'Details' },
      { id: 'parameters', label: 'Params' },
      { id: 'review', label: 'Review' },
    ];
    const steps_manual = [
      { id: 'method', label: 'Start' },
      { id: 'type', label: 'Type' },
      { id: 'details', label: 'Details' },
      { id: 'parameters', label: 'Params' },
      { id: 'review', label: 'Review' },
    ];
    const steps = creationMethod === 'ai' ? steps_ai : steps_manual;

    return (
      <div className="step-indicator">
        {steps.map((s, index) => (
          <div key={s.id} className={`step ${step === s.id ? 'active' : ''} ${steps.findIndex(x => x.id === step) > index ? 'completed' : ''}`}>
            <div className="step-number">{index + 1}</div>
            <span className="step-label">{s.label}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderMethodStep = () => (
    <div className="wizard-content method-selection">
      <h3>Set Your Starting Point</h3>
      <p className="subtitle">How would you like to build your strategy today?</p>

      <div className="method-grid">
        <div
          className={`method-card ${creationMethod === 'ai' ? 'selected' : ''}`}
          onClick={() => setCreationMethod('ai')}
        >
          <div className="method-icon-wrapper ai">
            <span className="method-icon">🤖</span>
          </div>
          <div className="method-info">
            <h4>AI Strategy Assistant</h4>
            <p>Describe your idea in plain English and let AI extract the core parameters for you.</p>
            <span className="method-badge">Recommended</span>
          </div>
        </div>

        <div
          className={`method-card ${creationMethod === 'manual' ? 'selected' : ''}`}
          onClick={() => setCreationMethod('manual')}
        >
          <div className="method-icon-wrapper manual">
            <span className="method-icon">🔧</span>
          </div>
          <div className="method-info">
            <h4>Start with Template</h4>
            <p>Choose from a list of proven strategy frameworks and configure them manually.</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTranscriptStep = () => (
    <div className="wizard-content transcript-step">
      <div className="details-header-row">
        <h3>AI Strategy Extraction</h3>
        <div className="agent-badge">
          <span className="agent-icon">🤖</span>
          <span>Powered by Financial Agent</span>
        </div>
      </div>
      <p className="subtitle">Explain your hypothesis, entry rules, and risk management.</p>

      <div className="agent-transcript-section ai-redesign">
          <div className="transcript-header-row">
            <label>Your Strategy Hypothesis & Rules</label>
            <div className="recording-status">
              {isRecording && <span className="pulse-dot"></span>}
              <span>
                {isRecording
                  ? recordingMode === 'local'
                    ? 'Recording locally...'
                    : 'Listening...'
                  : recordingMode === 'local'
                    ? 'Local recording mode'
                    : 'Ready to record'}
              </span>
            </div>
          </div>

        <div className="transcript-input-wrapper">
          <div className="ai-textarea-wrapper">
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="e.g., 'I want a 5-minute opening range breakout strategy for SPY...'"
              className="ai-transcript-area"
              disabled={isRecording}
            />

            <div className="ai-controls-overlay">
              {!isRecording && !transcript && (
                <div className="voice-prompt">
                  <span className="mic-icon-large">🎤</span>
                  <p>Click the button below to dictate your strategy</p>
                </div>
              )}
            </div>
          </div>

          <div className="voice-action-row">
            <button
              className={`mic-primary-btn ${isRecording ? 'active' : ''}`}
              onClick={toggleRecording}
            >
              <span className="mic-icon-main">{isRecording ? '⏹' : '🎤'}</span>
              {isRecording && <span className="mic-ring-animate"></span>}
            </button>
            <span className="action-hint">
              {isRecording
                ? recordingMode === 'local'
                  ? 'Click to stop, then auto-transcribe'
                  : 'Click to stop and edit'
                : recordingMode === 'local'
                  ? 'Local mode: click to record'
                  : 'Click to start recording'}
            </span>
          </div>

          <div className="audio-upload-row">
            <input
              ref={audioUploadRef}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
              onChange={handleAudioFileSelected}
              style={{ display: 'none' }}
            />
            <button
              className="btn-audio-upload"
              onClick={openAudioPicker}
              disabled={isRecording || isTranscribingAudio || isExtracting || Boolean(isProcessing)}
            >
              {isTranscribingAudio ? '⏳ Transcribing audio...' : '📎 Upload Audio File'}
            </button>
            <span className="action-hint">Upload meeting audio and auto-convert it to text</span>
          </div>

          {recordingError && (
            <div className="recording-error-msg">
              <span>{recordingError}</span>
              <button className="dismiss-error-btn" onClick={() => setRecordingError(null)}>Dismiss</button>
            </div>
          )}

          {audioUploadError && (
            <div className="recording-error-msg">
              <span>{audioUploadError}</span>
              <button className="dismiss-error-btn" onClick={() => setAudioUploadError(null)}>Dismiss</button>
            </div>
          )}

          {(isExtracting || isProcessing) ? (
            <div className="ai-processing-view">
              <div className="ai-loader-container">
                <div className="brain-pulse">🧠</div>
                <div className="scanning-line"></div>
                <div className="loading-text">Agent is analyzing your strategy...</div>
              </div>
            </div>
          ) : (
            <button
              className="btn-agent-action fluid-action"
              onClick={handleExtractFromTranscript}
              disabled={isRecording || !transcript.trim()}
            >
              🚀 Build Strategy from Description
            </button>
          )}
        </div>
      </div>


      {extractionStarted && (
        <div className="extraction-status-toast">
          <span className="spinner">⚡</span>
          <span>Background processing active... You can safely close this.</span>
        </div>
      )}

      {agentSuggestion && (
        <div className="agent-feedback-inline">
          <p>{agentSuggestion}</p>
        </div>
      )}
    </div>
  );

  const renderTypeStep = () => (
    <div className="wizard-content type-selection">
      <h3>Choose Strategy Type</h3>
      <p className="subtitle">Select a template or start from scratch</p>

      <div className="template-grid">
        {STRATEGY_TEMPLATES.map(template => (
          <div
            key={template.id}
            className={`template-card ${selectedType === template.id ? 'selected' : ''}`}
            onClick={() => handleTypeSelect(template.id)}
          >
            <span className="template-icon">{template.icon}</span>
            <h4>{template.name}</h4>
            <p>{template.description}</p>
          </div>
        ))}
      </div>

      {agentSuggestion && (
        <div className="agent-suggestion">
          <div className="suggestion-header">
            <span className="agent-icon">🤖</span>
            <span>Agent Suggestion</span>
          </div>
          <p>{agentSuggestion}</p>
        </div>
      )}
    </div>
  );

  const renderDetailsStep = () => (
    <div className="wizard-content details-form">
      <div className="details-header-row">
        <h3>Strategy Details</h3>
        <div className="agent-badge">
          <span className="agent-icon">🤖</span>
          <span>Agent Assisted</span>
        </div>
      </div>
      <p className="subtitle">Define your strategy or let the agent help you via transcript</p>

      {creationMethod === 'ai' ? (
        <div className="compact-transcript">
          <div className="compact-transcript-header">
            <span>Reference Transcript</span>
            <button className="btn-text-only" onClick={() => setStep('transcript')}>Edit</button>
          </div>
          <div className="compact-transcript-content">
            {transcript}
          </div>
        </div>
      ) : (
        <div className="agent-transcript-section">
          <label>Voice Assistant / Transcript</label>
          <div className="transcript-input-wrapper">
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Describe your strategy in plain English... e.g., 'I want a 5-minute opening range breakout strategy for SPY using 0DTE options...'"
              rows={3}
            />
            <button
              className={`btn-agent-action ${isExtracting ? 'loading' : ''}`}
              onClick={handleExtractFromTranscript}
              disabled={isExtracting || !transcript.trim()}
            >
              {isExtracting ? '⚡ Processing...' : '✨ Extract Parameters'}
            </button>
          </div>
          <p className="form-hint">Paste a transcript or describe your idea to auto-populate the fields below.</p>
        </div>
      )}

      <div className="form-divider"><span>OR FILL MANUALLY</span></div>

      <div className="form-group">
        <label>Strategy Name</label>
        <input
          type="text"
          value={strategyDetails.name}
          onChange={(e) => setStrategyDetails({ ...strategyDetails, name: e.target.value })}
          placeholder="e.g., VolArbitrage_v1"
        />
      </div>

      <div className="form-group">
        <label>Description</label>
        <textarea
          value={strategyDetails.description}
          onChange={(e) => setStrategyDetails({ ...strategyDetails, description: e.target.value })}
          placeholder="Brief description of what the strategy does..."
          rows={2}
        />
      </div>

      <div className="form-group">
        <label>Trading Hypothesis</label>
        <textarea
          value={strategyDetails.hypothesis}
          onChange={(e) => setStrategyDetails({ ...strategyDetails, hypothesis: e.target.value })}
          placeholder="e.g., When VIX term structure shows contango > 5%, shorting VXX generates positive returns..."
          rows={3}
        />
        <span className="form-hint">💡 A clear hypothesis helps validate your strategy during backtesting</span>
      </div>
    </div>
  );

  const renderParametersStep = () => (
    <div className="wizard-content parameters-form">
      <h3>Strategy Parameters</h3>
      <p className="subtitle">Configure initial parameters (can be optimized later)</p>

      <div className="parameters-grid">
        {Object.entries(parameters).map(([key, value]) => (
          <div key={key} className="form-group">
            <label>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</label>
            <input
              type={typeof value === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => setParameters({
                ...parameters,
                [key]: typeof value === 'number' ? parseFloat(e.target.value) : e.target.value
              })}
              step={typeof value === 'number' && value < 1 ? 0.01 : 1}
            />
          </div>
        ))}
      </div>

      <div className="agent-suggestion">
        <div className="suggestion-header">
          <span className="agent-icon">🤖</span>
          <span>Parameter Optimization</span>
        </div>
        <p>These are suggested starting parameters. After backtesting, I can help optimize them using Bayesian optimization while avoiding overfitting.</p>
      </div>
    </div>
  );

  const renderReviewStep = () => (
    <div className="wizard-content review-summary">
      <h3>Review & Create</h3>
      <p className="subtitle">Confirm your strategy configuration</p>

      <div className="review-section">
        <h4>Strategy Type</h4>
        <div className="review-value">
          <span className="review-icon">{selectedTemplate?.icon}</span>
          <span>{selectedTemplate?.name}</span>
        </div>
      </div>

      <div className="review-section">
        <h4>Details</h4>
        <div className="review-details">
          <div><strong>Name:</strong> {strategyDetails.name || 'Unnamed Strategy'}</div>
          <div><strong>Description:</strong> {strategyDetails.description || 'No description'}</div>
          <div><strong>Hypothesis:</strong> {strategyDetails.hypothesis || 'No hypothesis defined'}</div>
        </div>
      </div>

      <div className="review-section">
        <h4>Parameters</h4>
        <div className="parameters-review">
          {Object.entries(parameters).map(([key, value]) => (
            <div key={key} className="param-item">
              <span className="param-key">{key.replace(/_/g, ' ')}</span>
              <span className="param-value">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="next-steps">
        <h4>What's Next?</h4>
        <ul>
          <li>📝 Strategy will be created in <strong>Draft</strong> status</li>
          <li>💻 Open in Strategy Editor to write or refine code</li>
          <li>🔬 Run backtests to validate your hypothesis</li>
          <li>📊 Paper trade before going live</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className="strategy-wizard-overlay">
      <div className="strategy-wizard">
        <div className="wizard-header">
          <h2>✨ Create New Strategy</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        {renderStepIndicator()}

        <div className="wizard-body">
          {step === 'method' && renderMethodStep()}
          {step === 'transcript' && renderTranscriptStep()}
          {step === 'type' && renderTypeStep()}
          {step === 'details' && renderDetailsStep()}
          {step === 'parameters' && renderParametersStep()}
          {step === 'review' && renderReviewStep()}
        </div>

        <div className="wizard-footer">
          <button
            className="btn-secondary"
            onClick={step === 'method' ? onCancel : handleBack}
          >
            {step === 'method' ? 'Cancel' : '← Back'}
          </button>

          {step !== 'review' && step !== 'transcript' ? (
            <button
              className="btn-primary"
              onClick={handleNext}
              disabled={(step === 'method' && !creationMethod) || (step === 'type' && !selectedType)}
            >
              Next →
            </button>
          ) : step === 'transcript' ? null : (
            <button className="btn-primary create" onClick={handleComplete}>
              🚀 Create Strategy
            </button>
          )}
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .strategy-wizard-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .strategy-wizard {
    background: linear-gradient(180deg, #111118 0%, #0d0d12 100%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    width: 90%;
    max-width: 800px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
  }

  .wizard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .wizard-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: #e5e5e5;
  }

  .close-btn {
    background: none;
    border: none;
    color: #6b7280;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .close-btn:hover {
    color: #e5e5e5;
    background: rgba(255, 255, 255, 0.05);
  }

  .step-indicator {
    display: flex;
    justify-content: center;
    gap: 2rem;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .step {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #6b7280;
  }

  .step.active {
    color: #10b981;
  }

  .step.completed {
    color: #10b981;
  }

  .step-number {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .step.active .step-number {
    background: #10b981;
    color: white;
  }

  .step.completed .step-number {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .step-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .wizard-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .wizard-content h3 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
    color: #e5e5e5;
  }

  .subtitle {
    color: #6b7280;
    margin: 0 0 1.5rem;
    font-size: 0.9rem;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .template-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem;
    padding: 1.25rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }

  .template-card:hover {
    border-color: rgba(16, 185, 129, 0.3);
    background: rgba(255, 255, 255, 0.04);
  }

  .template-card.selected {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.1);
  }

  .template-icon {
    font-size: 2rem;
    display: block;
    margin-bottom: 0.75rem;
  }

  .template-card h4 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    color: #e5e5e5;
  }

  .template-card p {
    margin: 0;
    font-size: 0.8rem;
    color: #9ca3af;
    line-height: 1.4;
  }

  .agent-suggestion {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1rem;
  }

  .suggestion-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-weight: 600;
    color: #10b981;
    font-size: 0.9rem;
  }

  .agent-icon {
    font-size: 1rem;
  }

  .agent-suggestion p {
    margin: 0;
    color: #9ca3af;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .form-group {
    margin-bottom: 1.25rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: #e5e5e5;
    font-size: 0.9rem;
  }

  .form-group input,
  .form-group textarea {
    width: 100%;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    color: #e5e5e5;
    font-size: 0.9rem;
    transition: border-color 0.15s ease;
  }

  .form-group input:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: #10b981;
  }

  .form-hint {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: #6b7280;
  }

  .parameters-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  .review-section {
    margin-bottom: 1.5rem;
  }

  .review-section h4 {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .review-value {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1rem;
    color: #e5e5e5;
  }

  .review-icon {
    font-size: 1.25rem;
  }

  .review-details {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: #e5e5e5;
  }

  .review-details strong {
    color: #9ca3af;
    font-weight: 500;
  }

  .parameters-review {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .param-item {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 0.375rem;
  }

  .param-key {
    color: #9ca3af;
    font-size: 0.85rem;
    text-transform: capitalize;
  }

  .param-value {
    color: #e5e5e5;
    font-weight: 500;
    font-size: 0.85rem;
  }

  .next-steps {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1rem;
  }

  .next-steps h4 {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    color: #e5e5e5;
  }

  .next-steps ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .next-steps li {
    padding: 0.5rem 0;
    color: #9ca3af;
    font-size: 0.875rem;
  }

  .wizard-footer {
    display: flex;
    justify-content: space-between;
    padding: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .btn-secondary,
  .btn-primary {
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    font-size: 0.9rem;
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #9ca3af;
  }

  .btn-secondary:hover {
    border-color: rgba(255, 255, 255, 0.3);
    color: #e5e5e5;
  }

  .btn-primary {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border: none;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary.create {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
  }

  .details-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .agent-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.3);
    padding: 0.25rem 0.75rem;
    border-radius: 2rem;
    color: #10b981;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .agent-transcript-section {
    background: rgba(16, 185, 129, 0.05);
    border: 1px solid rgba(16, 185, 129, 0.1);
    border-radius: 0.75rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .agent-transcript-section label {
    display: block;
    margin-bottom: 0.75rem;
    font-weight: 600;
    color: #10b981;
    font-size: 0.9rem;
  }

  .transcript-input-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .transcript-input-wrapper textarea {
    background: rgba(0, 0, 0, 0.2);
    border-color: rgba(16, 185, 129, 0.2);
  }

  .btn-agent-action {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border: none;
    color: white;
    padding: 0.75rem;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-agent-action:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }

  .btn-agent-action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-agent-action.loading {
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.7; }
    100% { opacity: 1; }
  }

  .form-divider {
    display: flex;
    align-items: center;
    text-align: center;
    color: #4b5563;
    font-size: 0.75rem;
    font-weight: 700;
    margin: 1.5rem 0;
  }

  .form-divider::before,
  .form-divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .form-divider:not(:empty)::before {
    margin-right: 1rem;
  }

  .form-divider:not(:empty)::after {
    margin-left: 1rem;
  }

  /* Redesign Styles */
  .method-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-top: 2rem;
  }

  .method-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 2rem 1.5rem;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  .method-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-4px);
  }

  .method-card.selected {
    background: rgba(16, 185, 129, 0.05);
    border-color: #10b981;
    box-shadow: 0 0 20px rgba(16, 185, 129, 0.15);
  }

  .method-icon-wrapper {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    margin-bottom: 1.5rem;
  }

  .method-icon-wrapper.ai {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
  }

  .method-icon-wrapper.manual {
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
  }

  .method-info h4 {
    font-size: 1.25rem;
    margin-bottom: 0.75rem;
    color: white;
  }

  .method-info p {
    font-size: 0.9rem;
    color: #9ca3af;
    line-height: 1.5;
  }

  .method-badge {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: #10b981;
    color: white;
    font-size: 0.7rem;
    font-weight: 800;
    padding: 0.2rem 0.6rem;
    border-radius: 2rem;
    text-transform: uppercase;
  }

  /* AI Input Redesign Styles */
  .agent-transcript-section.ai-redesign {
    background: rgba(16, 185, 129, 0.03);
    border: 1px solid rgba(16, 185, 129, 0.1);
    border-radius: 1.5rem;
    padding: 2rem;
    margin: 1rem 0;
  }

  .transcript-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .transcript-header-row label {
    font-size: 1.1rem;
    font-weight: 700;
    color: #10b981;
  }

  .recording-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #9ca3af;
    font-weight: 600;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: #ef4444;
    border-radius: 50%;
    animation: pulse-dot 1s infinite;
  }

  @keyframes pulse-dot {
    0% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.5); opacity: 0.5; }
    100% { transform: scale(1); opacity: 1; }
  }

  .ai-textarea-wrapper {
    position: relative;
    border-radius: 1rem;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(16, 185, 129, 0.15);
    margin-bottom: 2rem;
    transition: all 0.3s ease;
  }

  .ai-textarea-wrapper:focus-within {
    border-color: #10b981;
    box-shadow: 0 0 15px rgba(16, 185, 129, 0.1);
  }

  .ai-transcript-area {
    width: 100%;
    padding: 1.5rem;
    background: transparent;
    border: none;
    outline: none;
    color: white;
    font-family: 'Inter', sans-serif;
    font-size: 1.1rem;
    line-height: 1.7;
    min-height: 250px;
    resize: none;
  }

  .ai-transcript-area:disabled {
    opacity: 0.8;
    cursor: default;
  }

  .ai-controls-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    text-align: center;
    width: 100%;
  }

  .voice-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    color: #4b5563;
  }

  .mic-icon-large {
    font-size: 3rem;
    opacity: 0.2;
  }

  .voice-action-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 2.5rem;
  }

  .audio-upload-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    margin: 0 0 1.5rem;
  }

  .mic-primary-btn {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: #10b981;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 25px rgba(16, 185, 129, 0.3);
  }

  .mic-primary-btn:hover {
    transform: scale(1.05);
    background: #059669;
  }

  .mic-primary-btn.active {
    background: #ef4444;
    box-shadow: 0 8px 25px rgba(239, 68, 68, 0.4);
    animation: mic-vibrate 0.1s infinite;
  }

  @keyframes mic-vibrate {
    0% { transform: translate(0); }
    25% { transform: translate(1px, 1px); }
    50% { transform: translate(-1px, 0); }
    75% { transform: translate(0, -1px); }
    100% { transform: translate(0); }
  }

  .mic-ring-animate {
    position: absolute;
    width: 100%;
    height: 100%;
    background: rgba(239, 68, 68, 0.4);
    border-radius: 50%;
    animation: ring-pulse 2s infinite;
    z-index: -1;
  }

  @keyframes ring-pulse {
    0% { transform: scale(1); opacity: 0.7; }
    100% { transform: scale(2.5); opacity: 0; }
  }

  .action-hint {
    font-size: 0.9rem;
    color: #9ca3af;
    font-weight: 600;
  }

  .btn-audio-upload {
    border: 1px solid rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.12);
    color: #d1fae5;
    padding: 0.7rem 1rem;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-audio-upload:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.5);
  }

  .btn-audio-upload:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .fluid-action {
    width: 100%;
    padding: 1.25rem !important;
    font-size: 1.1rem !important;
    border-radius: 1rem !important;
    text-transform: none !important;
    letter-spacing: normal !important;
  }

  /* Custom Scrollbar for Wizard */
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 5px;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 5px;
    border: 2px solid rgba(0, 0, 0, 0.1);
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* Compact Transcript styles */
  .compact-transcript {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 0.75rem;
    padding: 1rem;
    margin-bottom: 2rem;
    position: relative;
  }

  .compact-transcript-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    font-size: 0.8rem;
    color: #10b981;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .compact-transcript-content {
    font-size: 0.9rem;
    color: #9ca3af;
    line-height: 1.5;
    max-height: 100px;
    overflow-y: auto;
    font-style: italic;
  }

  .btn-text-only {
    background: none;
    border: none;
    color: #10b981;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    text-transform: uppercase;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .btn-text-only:hover {
    opacity: 1;
    text-decoration: underline;
  }

  .loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(10, 10, 15, 0.85);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 1rem;
    animation: fade-in 0.3s ease;
  }

  .ai-loader-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
  }

  .brain-pulse {
    font-size: 5rem;
    animation: brain-glow 2s infinite ease-in-out;
    filter: drop-shadow(0 0 15px rgba(16, 185, 129, 0.5));
  }

  @keyframes brain-glow {
    0% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.1); opacity: 1; filter: drop-shadow(0 0 25px rgba(16, 185, 129, 0.8)); }
    100% { transform: scale(1); opacity: 0.8; }
  }

  .scanning-line {
    width: 200px;
    height: 2px;
    background: linear-gradient(90deg, transparent, #10b981, transparent);
    position: relative;
    overflow: hidden;
  }

  .scanning-line::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 200%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.8), transparent);
    animation: scan-move 1.5s infinite linear;
  }

  @keyframes scan-move {
    from { left: -100%; }
    to { left: 100%; }
  }

  .loading-text {
    font-size: 1.25rem;
    font-weight: 600;
    color: white;
    margin-top: 1rem;
    letter-spacing: 0.05em;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .recording-error-msg {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.85rem;
    line-height: 1.5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .dismiss-error-btn {
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    padding: 0.25rem 0.75rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
    font-weight: 600;
  }

  .dismiss-error-btn:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  .extraction-status-toast {
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid #10b981;
    color: #10b981;
    padding: 1rem;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
    font-weight: 600;
    animation: pulse 2s infinite;
  }

  .ai-processing-view {
    background: rgba(16, 185, 129, 0.05);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 0.75rem;
    padding: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1rem;
    min-height: 150px;
  }

  .ai-loader-container {
    text-align: center;
    width: 100%;
  }

  .brain-pulse {
    font-size: 3rem;
    animation: brain-pulse 2s infinite ease-in-out;
  }

  @keyframes brain-pulse {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.1); opacity: 1; }
  }

  .scanning-line {
    height: 4px;
    width: 100%;
    margin: 1.5rem 0;
    background: linear-gradient(90deg, transparent, #10b981, transparent);
    position: relative;
    overflow: hidden;
  }

  .spinner {
    display: inline-block;
    animation: spin 2s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

export default StrategyCreationWizard;
