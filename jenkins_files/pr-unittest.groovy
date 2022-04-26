#!/usr/bin/env groovy

@Library('SFE-RTC-pipeline') _

properties([
    parameters(withRunConfig([
        string(name: "JENKINS_NODE_LABEL", defaultValue: "syc9-test-win", description: "Label for the jenkins node which the job will run on")
    ])),

    buildDiscarder(logRotator(artifactNumToKeepStr: '15', numToKeepStr: '15'))
])

abortPreviousRunningBuilds()

notifyPRStatus("tests/unit") {
    node(params.JENKINS_NODE_LABEL) {
        cleanWs()
        checkout scm

        common = load("jenkins_files/common.groovy")

        try {
            common.withNvmVer {
                try {
                    stage("Run unit tests") {
                        bat """
                            call "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat"
                            call npm install
                            call npm run prebuild
                            call npm run test:unit
                        """
                    }
                } finally {
                    stage("Post Actions") {
                    }
                }
            }
        } finally {
            cleanWs()
        }
    }
}
