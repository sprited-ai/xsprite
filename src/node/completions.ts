/** Shell completion scripts, printed by `sprited completion <shell>`.
 * Static strings — the CLI surface is small enough that keeping these in
 * sync by hand beats pulling in a completion framework. */

export const ZSH = `_sprited() {
  local -a commands
  commands=(
    'gen:generate a character (gen char [name])'
    'build:build a character from flags or a config file'
    'extract:slice a filled direction sheet into sprites'
    'extract-anim:slice an animation strip into frames'
    'check:VLM-review a spritesheet for defects'
    'completion:print a shell completion script'
  )
  if (( CURRENT == 2 )); then
    _describe -t commands 'sprited command' commands
    return
  fi
  local -a genflags
  genflags=(
    '(-d --description)'{-d,--description}'[extra guidance for the model]:description:'
    '(-r --reference)'{-r,--reference}'[reference image]:reference:_files -g "*.png"'
    '--seed[generation seed (number or random)]:seed:'
    '(-o --output)'{-o,--output}'[output directory]:output:_files -/'
    '--sheet[keep the raw generated sheet]'
    '--template[builtin template]:template:(8dir-v1)'
    '--provider[model provider]:provider:(gemini novita-seedream novita-qwen)'
    '--matting[background removal]:matting:(floodfill toonout)'
    '--no-check[skip the post-generation review/fix]'
    '--max-fixes[max review/fix rounds (default 1)]:rounds:'
    '--report[write <name>.report.md with the build log and images]'
    '--intermediate[write intermediate images under <name>.intermediate/]'
  )
  case \${words[2]} in
    gen)
      if (( CURRENT == 3 )); then
        compadd char
      else
        _arguments "\${genflags[@]}"
      fi
      ;;
    build)
      _arguments "\${genflags[@]}" ':name or config:_files -g "*.(yaml|yml|json)"'
      ;;
    extract)
      _arguments \\
        ':sheet:_files -g "*.png"' \\
        '--row[panel row index]:row:' \\
        '--skip-ref[leading cells to skip]:cells:' \\
        '(-o --output)'{-o,--output}'[output directory]:output:_files -/'
      ;;
    extract-anim)
      _arguments \\
        ':sheet:_files -g "*.png"' \\
        '--frames[frame count]:frames:' \\
        '--fps[playback fps]:fps:' \\
        '--canvas[canvas size]:px:' \\
        '--row[panel row index]:row:' \\
        '--skip-ref[leading cells to skip]:cells:' \\
        '(-o --output)'{-o,--output}'[output directory]:output:_files -/'
      ;;
    check)
      _arguments \\
        ':spritesheet:_files -g "*.png"' \\
        '(-d --description)'{-d,--description}'[what the character should be]:description:' \\
        '--fix[repair defects via the image model]' \\
        '(-o --output)'{-o,--output}'[fixed sheet path]:output:_files -g "*.png"'
      ;;
    completion)
      compadd zsh bash
      ;;
  esac
}
compdef _sprited sprited
`;

export const BASH = `_sprited() {
  local cur prev cmd
  cur=\${COMP_WORDS[COMP_CWORD]}
  prev=\${COMP_WORDS[COMP_CWORD-1]}
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "gen build extract extract-anim check completion" -- "$cur"))
    return
  fi
  cmd=\${COMP_WORDS[1]}
  case $prev in
    --provider) COMPREPLY=($(compgen -W "gemini novita-seedream novita-qwen" -- "$cur")); return ;;
    --matting) COMPREPLY=($(compgen -W "floodfill toonout" -- "$cur")); return ;;
    --template) COMPREPLY=($(compgen -W "8dir-v1" -- "$cur")); return ;;
    -o|--output) COMPREPLY=($(compgen -d -- "$cur")); return ;;
    -r|--reference) COMPREPLY=($(compgen -f -- "$cur")); return ;;
  esac
  case $cur in
    -*)
      case $cmd in
        gen|build) COMPREPLY=($(compgen -W "-d --description -r --reference --seed -o --output --sheet --template --provider --matting --no-check --max-fixes --report --intermediate" -- "$cur")) ;;
        check) COMPREPLY=($(compgen -W "-d --description --fix -o --output" -- "$cur")) ;;
        extract) COMPREPLY=($(compgen -W "--row --skip-ref -o --output" -- "$cur")) ;;
        extract-anim) COMPREPLY=($(compgen -W "--frames --fps --canvas --row --skip-ref -o --output" -- "$cur")) ;;
      esac
      return ;;
  esac
  case $cmd in
    gen) [ "$COMP_CWORD" -eq 2 ] && COMPREPLY=($(compgen -W "char" -- "$cur")) ;;
    completion) COMPREPLY=($(compgen -W "zsh bash" -- "$cur")) ;;
    *) COMPREPLY=($(compgen -f -- "$cur")) ;;
  esac
}
complete -F _sprited sprited
`;
