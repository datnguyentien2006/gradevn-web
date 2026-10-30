import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { initPwa } from './pwa';

if (new URLSearchParams(location.search).get('debug') === '1') {
  void import('eruda')
    .then(({ default: eruda }) => eruda.init())
    .catch(() => {});
}

const target = document.getElementById('app');
if (target) mount(App, { target });

initPwa();

if (navigator.storage?.persist) {
  void navigator.storage.persist();
}
