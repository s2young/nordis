module.exports.getSID = function(nLength) {
    var sID = '';
    var aChars = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','y','x','z','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Y','0','1','2','3','4','5','6','7','8','9'];
    nLength = (nLength && nLength>0) ? nLength : 6;
    for (var i = 0; i < nLength; i++) {
        sID += aChars[Math.floor(Math.random()*aChars.length)];
    }
    return sID;
};

module.exports.encodeHtml = function(sHtml) {
    return sHtml.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
};

module.exports.randomXToY = function(minVal,maxVal,floatVal) {
    var randVal = minVal+(Math.random()*(maxVal-minVal));
    return typeof floatVal=='undefined'?Math.round(randVal):randVal.toFixed(floatVal);
};

module.exports.isHexColor = function(sColor) {
    return /(^#[0-9A-F]{6}$)|(^#[0-9A-F]{3}$)/i.test(sColor);
};

module.exports.getUrlsFromString = function(sValue) {
    if (sValue) {
        var re = new RegExp(/\b(http[s]?:\/\/[^\s"']*)/g);
        var aMatches = sValue.match(re);
        return aMatches;
    } else
        return;

}
module.exports.trim = function(sText) {
    if (sText)
        return sText.replace(/^\s+|\s+$/g,"");
    else
        return sText;
};
module.exports.ltrim = function(sText) {
    if (sText)
        return sText.replace(/^\s+/,"");
    else
        return sText;
};
module.exports.rtrim = function(sText) {
    if (sText)
        return sText.replace(/\s+$/,"");
    else
        return sText;
};
module.exports.clean = function(s) {
    // Strip out windows/ms word crap characters.
    if (s) {
        s = s.replace( /\u2018|\u2019|\u201A|\uFFFD/g, "'" );
        s = s.replace( /\u201c|\u201d|\u201e/g, '"' );
        s = s.replace( /\u02C6/g, '^' );
        s = s.replace( /\u2039/g, '<' );
        s = s.replace( /\u203A/g, '>' );
        s = s.replace( /\u2013/g, '-' );
        s = s.replace( /\u2014/g, '--' );
        s = s.replace( /\u2026/g, '...' );
        s = s.replace( /\u00A9/g, '(c)' );
        s = s.replace( /\u00AE/g, '(r)' );
        s = s.replace( /\u2122/g, 'TM' );
        s = s.replace( /\u00BC/g, '1/4' );
        s = s.replace( /\u00BD/g, '1/2' );
        s = s.replace( /\u00BE/g, '3/4' );
        s = s.replace(/[\u02DC|\u00A0]/g, " ");
        s = s.replace(/\\/g,"");
        // xss clean.
        //s = sanitize(s).xss();
    }
    return s;
}
module.exports.isValidEmail = function(sEmail) {
    if (!sEmail)
        return null;
    else {
        sEmail = this.trim(sEmail);
        sEmail = sEmail.toLowerCase();
        if (sEmail.match(new RegExp(/[A-Za-z0-9\.\_\%\+-]+@[A-Za-z0-9\.-]+\.[A-Za-z]{2,4}$/))) {
            return sEmail;
        } else {
            return null;
        }
    }
};
// TODO: NOTE: This no longer parses multiple numbers from a string. It expects a single string purported to
// contain one number.
module.exports.isValidPhone = function(sNum,bReturnCountry,bFullOnly,aSupportedCountries) {
    if (sNum) {
        sNum = sNum.toString().replace(new RegExp(/\D/g),'');
        sNum = this.trim(sNum);
        for (var n = 0; n < aSupportedCountries.length; n++) {
            var hCountry = aSupportedCountries[n];
            if (sNum.match(new RegExp(hCountry.sFULL))) {
                if (!bReturnCountry)
                    return sNum;
                else
                    return {sPhone:sNum,sCountry:hCountry.sCode}
            } else if (!bFullOnly && sNum.match(new RegExp(hCountry.sAREA))) {
                if (!bReturnCountry)
                    return hCountry.nPhone+sNum;
                else
                    return {sPhone:hCountry.nPhone+sNum,sCountry:hCountry.sCode}
            }
        }
    }
    return null;
};

module.exports.prettifyPhone = function(sNum,aSupportedCountries) {
    sNum = sNum.replace(new RegExp(/\D/g),'');
    sNum = this.trim(sNum);
    for (var n = 0; n < aSupportedCountries.length; n++) {
        var hCountry = aSupportedCountries[n];
        if (sNum && sNum.match(new RegExp(hCountry.sFULL))) {
            sNum = sNum.substring(1);
        } else if (!sNum.match(new RegExp(hCountry.sAREA))) {
            sNum = null;
        }

        if (sNum) {
            var sPretty = sNum;
            var aMatches = sNum.match(new RegExp(hCountry.sPrettify));
            if (aMatches)
                if (hCountry.sCode == 'us') {
                    sPretty = aMatches[1]+'-'+aMatches[2]+'-'+aMatches[3];
                    return sPretty;
                }
        }
    }
    return sNum;
};

module.exports.isMobileBrowser = function(sUserAgent) {
    var rExp = new RegExp(/Mobile|iP(hone|od|ad)|Android|BlackBerry|IEMobile|Kindle|NetFront|Silk-Accelerated|(hpw|web)OS|Fennec|Minimo|Opera M(obi|ini)|Blazer|Dolfin|Dolphin|Skyfire|Zune/);
    return (sUserAgent && sUserAgent.match(rExp));
};

module.exports.isHeadless = function(sUserAgent) {
    return (sUserAgent == undefined);
};

module.exports.stripHtml = function(sHtml) {
    var rE = new RegExp(/<(.|\n)*?>/g);
    if (sHtml) {
        var matches = sHtml.match(rE);
        if (matches && matches.length)
            matches.forEach(function(item){
                var replace = '';
                switch (item) {
                    case '</p>':case '<br/>':case '<br>':
                    replace = '\n';
                    break;
                }
                sHtml = sHtml.replace(item,replace);
            });
    }
    return sHtml;
};


module.exports.cleanForMySql = function(str) {
    return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
        switch (char) {
            case "\0":
                return "\\0";
            case "\x08":
                return "\\b";
            case "\x09":
                return "\\t";
            case "\x1a":
                return "\\z";
            case "\n":
                return "\\n";
            case "\r":
                return "\\r";
            case "\"":
            case "'":
            case "\\":
            case "%":
                return "\\"+char; // prepends a backslash to backslash, percent,
            // and double/single quotes
        }
    });
};