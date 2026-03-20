import { User, Sparkles } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser
            ? 'bg-gradient-to-br from-gray-700 to-gray-900'
            : 'bg-gradient-to-br from-purple-500 to-blue-500'
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4 text-white" />
        ) : (
          <Sparkles className="h-4 w-4 text-white" />
        )}
      </div>

      {/* Message Bubble */}
      <div
        className={`flex-1 max-w-[80%] ${
          isUser
            ? 'bg-gradient-to-br from-purple-500 to-blue-500 text-white rounded-2xl rounded-tr-sm'
            : 'bg-gray-100 rounded-2xl rounded-tl-sm'
        } px-4 py-3`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
}
