@echo off
rem Wrapper exigido pelo Native Messaging do Chrome no Windows: o "path" do
rem manifest precisa apontar para um .exe/.bat/.cmd, nao para um .js direto.
node "%~dp0host.js"
