'use client';

import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Provider } from 'react-redux';
import { store } from '../../redux/store';

const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        background: {
            default: '#131722',
        },
        info: {
            main: '#171B26',
        },
    },
    components: {
        MuiTable: {
            styleOverrides: {
                root: {
                    backgroundColor: '#171B26',
                    borderColor: '#363C4E',
                    textTransform: 'uppercase',
                },
            },
        },
        MuiTableBody: {
            styleOverrides: {
                root: {
                    textTransform: 'uppercase',
                    maxHeight: '400px',
                },
            },
        },
    },
});

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <LocalizationProvider dateAdapter={AdapterMoment}>
            <ThemeProvider theme={darkTheme}>
                <Provider store={store}>{children}</Provider>
            </ThemeProvider>
        </LocalizationProvider>
    );
}
