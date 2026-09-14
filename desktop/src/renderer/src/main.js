import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { initializeTheme } from './theme.js';

initializeTheme();

createApp(App).mount('#app');
