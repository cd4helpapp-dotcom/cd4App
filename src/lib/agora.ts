let Agora: any = null;
let surfaceView: any = null;
let textureView: any = null;

try {
    Agora = require('react-native-agora');
    surfaceView = Agora.RtcSurfaceView;
    textureView = Agora.RtcTextureView || Agora.RtcSurfaceView;
} catch (e) {
    console.warn('Agora not available');
}

export default Agora;
export const RtcSurfaceView = surfaceView;
export const RtcTextureView = textureView;
