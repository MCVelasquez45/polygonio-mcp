import { Plus, MessageSquare, X, Clock, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';

interface SidebarProps {
  isOpen: boolean;
  onNewChat: () => void;
  onClose: () => void;
}

const mockChats = [
  { id: '1', title: 'Creative writing tips', time: '2 hours ago' },
  { id: '2', title: 'Python code review', time: '5 hours ago' },
  { id: '3', title: 'Marketing strategy ideas', time: 'Yesterday' },
  { id: '4', title: 'Recipe for pasta carbonara', time: 'Yesterday' },
  { id: '5', title: 'Travel planning for Japan', time: '2 days ago' },
  { id: '6', title: 'Resume feedback', time: '3 days ago' },
  { id: '7', title: 'Math homework help', time: '1 week ago' },
];

export function Sidebar({ isOpen, onNewChat, onClose }: SidebarProps) {
  if (!isOpen) return null;

  return (
    <div className="w-80 h-full bg-white border-r flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <h2>AI Chat</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="md:hidden">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <Button onClick={onNewChat} className="w-full gap-2 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600">
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Chat History */}
      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-1">
          <div className="px-3 py-2 text-gray-500" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent
          </div>
          {mockChats.map((chat) => (
            <button
              key={chat.id}
              className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-100 transition-colors text-left group"
            >
              <MessageSquare className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-gray-900">{chat.title}</p>
                <div className="flex items-center gap-1 text-gray-500 mt-0.5" style={{ fontSize: '0.75rem' }}>
                  <Clock className="h-3 w-3" />
                  {chat.time}
                </div>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-4 border-t">
        <div className="px-3 py-2 bg-purple-50 rounded-lg">
          <p className="text-purple-900" style={{ fontSize: '0.875rem' }}>
            ✨ Upgrade to Pro
          </p>
          <p className="text-purple-700 mt-1" style={{ fontSize: '0.75rem' }}>
            Get unlimited messages and access to advanced features
          </p>
        </div>
      </div>
    </div>
  );
}
