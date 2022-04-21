#!/usr/bin/env groovy

def withNvmVer(Closure body) {
    withNvm("v12.13.1", "npmrcFile") {\
        body()
    }
}

return this
