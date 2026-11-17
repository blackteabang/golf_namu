// 홈 화면 설치 배너를 언제, 어떤 문구로 보일지 정한다.
(function (global) {
    var DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

    function dismissed(at, now) {
        at = Number(at) || 0;
        if (!at) return false;
        return (Number(now) || 0) - at < DISMISS_MS;
    }

    function isIOS(ua) {
        return /iPhone|iPad|iPod/i.test(ua || '');
    }

    function isInApp(ua) {
        return /KAKAOTALK|NAVER\(|FBAN|FBAV|Instagram|Line\//i.test(ua || '');
    }

    function isKakaoAndroid(ua) {
        return /KAKAOTALK/i.test(ua || '') && /Android/i.test(ua || '');
    }

    function modeOf(env) {
        env = env || {};
        if (env.standalone) return 'hidden';
        if (env.inApp) return 'inapp';
        if (env.ios) return 'ios';
        if (env.hasPrompt) return 'prompt';
        return 'manual';
    }

    function shouldShow(env) {
        env = env || {};
        var mode = modeOf(env);
        if (env.standalone || mode === 'hidden') return false;
        if (env.force) return true;
        if (mode === 'manual') return false;
        return !dismissed(env.dismissedAt, env.now);
    }

    function copyFor(mode) {
        if (mode === 'ios') {
            return { title: '홈 화면에 추가', detail: "공유 버튼 → '홈 화면에 추가'", action: '' };
        }
        if (mode === 'inapp') {
            return { title: '브라우저에서 열기', detail: '홈 화면 설치는 Chrome·삼성 인터넷에서', action: '' };
        }
        if (mode === 'manual') {
            return { title: '홈 화면에 추가', detail: '브라우저 메뉴에서 설치할 수 있어요', action: '' };
        }
        return { title: '홈 화면에 추가', detail: '앱처럼 바로 열기', action: '추가' };
    }

    function chromeIntent(pageUrl) {
        var url = new URL(pageUrl);
        var scheme = url.protocol.replace(':', '');
        return 'intent://' + url.host + url.pathname + url.search + '#Intent;scheme=' + scheme + ';package=com.android.chrome;end';
    }

    function skipsFetch(url) {
        var host = '';
        try {
            host = new URL(url).hostname || '';
        } catch (error) {
            return true;
        }
        return host.indexOf('firebase') !== -1 || host.indexOf('googleapis.com') !== -1 || host.indexOf('gstatic.com') !== -1;
    }

    global.GolfInstall = {
        DISMISS_MS: DISMISS_MS,
        dismissed: dismissed,
        isIOS: isIOS,
        isInApp: isInApp,
        isKakaoAndroid: isKakaoAndroid,
        modeOf: modeOf,
        shouldShow: shouldShow,
        copyFor: copyFor,
        chromeIntent: chromeIntent,
        skipsFetch: skipsFetch
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
