let GoogleSignin: any;
let statusCodes: any = {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

try {
    const googleSigninModule = require('@react-native-google-signin/google-signin');
    GoogleSignin = googleSigninModule.GoogleSignin;
    statusCodes = googleSigninModule.statusCodes || statusCodes;
} catch (e) {
    console.warn('GoogleSignin native module is unavailable. Use a development build instead of Expo Go.');
}

const unavailableErrorMessage =
    'Google Sign-In is unavailable in this build. Please use a development/client build (not Expo Go).';

const buildUnavailableError = () => new Error(unavailableErrorMessage);

if (!GoogleSignin) {
    GoogleSignin = {
        configure: () => {
            throw buildUnavailableError();
        },
        hasPlayServices: async () => {
            throw buildUnavailableError();
        },
        signIn: async () => {
            throw buildUnavailableError();
        },
        signOut: async () => {
            throw buildUnavailableError();
        },
        isSignedIn: async () => false,
        getCurrentUser: async () => null,
    };
}

export { GoogleSignin, statusCodes };
