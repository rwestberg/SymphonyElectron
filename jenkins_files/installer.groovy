#!/usr/bin/env groovy

@Library('SFE-RTC-pipeline') _

properties([
    parameters(withRunConfig([
        string(name: "JENKINS_NODE_LABEL", defaultValue: "syc9-test-win", description: "Label for the jenkins node which the job will run on"),
        string(name: "SDA_C9_DEPS", defaultValue: "https://jenkins.rtc.dev.symphony.com/job/SFE%20-%20Cloud9%20Integration/job/SDA%20Bundle%20Dependencies/lastSuccessfulBuild/artifact/syc9-sda-deps.zip", description: "The C9 dependencies bundle to add to the installer."),
        string(name: "SDA_LIBS", defaultValue: "https://jenkins.rtc.dev.symphony.com/job/SFE%20-%20Cloud9%20Integration/job/SDA%20Bundle%20Libraries/lastSuccessfulBuild/artifact/syc9-sda-libraries.zip", description: "The SDA library bundle to add to the installer."),
    ])),

    buildDiscarder(logRotator(artifactNumToKeepStr: '15', numToKeepStr: '15'))
])

abortPreviousRunningBuilds()

node(params.JENKINS_NODE_LABEL) {
    def artifactory = ArtifactoryServer "https://repo.symphony.com/artifactory", "jenkins-artifactory-credentials"

    cleanWs()
    checkout scm

    common = load("jenkins_files/common.groovy")

    try {
        common.withNvmVer {
            try {
                stage("Build SDA") {
                    bat """
                        call "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat"
                        sed -i -e "s/\\"buildNumber\\"[[:space:]]*\\:[[:space:]]*\\".*\\"/\\"buildNumber\\":\\"%BUILD_NUMBER%\\"/g" package.json
                        call npm install
                        call npm run unpacked-win
                    """
                }
                stage("Fetch C9 dependencies") {
                    sh "mkdir -p download"
                    sh "curl -L '${params.SDA_C9_DEPS}' -o download/syc9-sda-deps.zip"
                }
                stage("Extract C9 dependencies") {
                    bat "powershell Expand-Archive download\\syc9-sda-deps.zip dist\\win-unpacked"
                }
                stage("Fetch SDA libraries") {
                    sh "curl -L '${params.SDA_LIBS}' -o download/syc9-sda-libraries.zip"
                }
                stage("Extract SDA libraries") {
                    bat "powershell Expand-Archive download\\syc9-sda-libraries.zip ."
                }
                stage("Create installer") {
                    bat """
                        call "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat"
                        call node -e "console.log(require('./package.json').version);" > version.txt
                        set /p baseVer=<version.txt
                        set SYMVER=%baseVer%
                        mkdir targets
                        set archiveName=Symphony-C9-Win64-%SYMVER%-%BUILD_NUMBER%
                        cd installer\\win
                        call BuildWixSharpInstaller.bat
                        copy "WixSharpInstaller\\Symphony.msi" "..\\..\\targets\\%archiveName%.msi"
                    """
                }
                stage("Publish installer artifact") {
                    archiveArtifacts artifacts: 'targets/*', fingerprint: false
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
