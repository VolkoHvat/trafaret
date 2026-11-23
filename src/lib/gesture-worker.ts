import { replay } from './gesture-diagnostic'
self.onmessage = ({ data }) => {
  try { self.postMessage({ diff: replay(data.g, data.brush) }) }
  catch (e) { self.postMessage({ error: String(e) }) }
}
