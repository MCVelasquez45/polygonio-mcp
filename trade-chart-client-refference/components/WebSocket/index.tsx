import { createContext, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { config } from '../..//constants';
import { useDispatch } from 'react-redux';
import { addBar } from '../../redux/features/crypto/cryptoSlice';

const wsUrl = config.SERVER_URL || '';

const WebSocketContext = createContext<{ socket: Socket } | null>(null);

export { WebSocketContext };

export default function WebSocket({ children }: { children: ReactNode }) {
    let socket;

    const dispatch = useDispatch();

    if (!socket) {
        socket = io(wsUrl, { transports: ['websocket', 'polling', 'flashsocket'] });
        socket.on('bar', (bar) => {
            dispatch(addBar(bar));
        });
    }

    const ws = {
        socket: socket,
    };

    return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>;
}
